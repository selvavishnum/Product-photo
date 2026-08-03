import { neon } from '@neondatabase/serverless';

/**
 * Storage for the daily-post queue.
 *
 * The rest of the app is deliberately stateless -- the wizard round-trips its
 * plan through the browser, which is simpler than a session store when the
 * browser is always open. Scheduled posting breaks that: the whole point is
 * that it runs when nobody is looking, so the shop's details and the queue
 * have to live somewhere that outlasts a request.
 *
 * Neon's HTTP driver rather than a pooled TCP client: serverless functions
 * come and go, and a connection pool that cannot be reused between
 * invocations is a liability, not an optimisation. Plain SQL rather than
 * Prisma: this is two tables, and Prisma would add a generate step to every
 * Vercel build for no benefit at this size.
 */

export class DbNotConfigured extends Error {
  constructor() {
    // Worded for whoever hit it. This was "Scheduled posting needs a
    // database", which is where it first came up -- but the connect page
    // shows the same error, and telling someone trying to link Instagram
    // about scheduled posting reads as a different problem entirely.
    super(
      'This needs a database. Create a Postgres store in Vercel ' +
        '(Storage -> Postgres), connect it to this project and redeploy; it ' +
        'sets DATABASE_URL automatically.',
    );
    this.name = 'DbNotConfigured';
  }
}

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbNotConfigured();
  return neon(url);
}

/**
 * Creates the tables if they are missing.
 *
 * Called at the start of each route that touches the database rather than run
 * as a migration step. With two tables that only ever grow columns, a real
 * migration tool is more moving parts than the problem deserves, and
 * `IF NOT EXISTS` makes it safe to repeat.
 */
export async function ensureSchema(): Promise<void> {
  const q = sql();

  // One row, id fixed at 1. The single-shop shape is deliberate and visible:
  // when this becomes multi-tenant the constraint is what forces the change
  // to be noticed rather than silently mixing two shops' posts.
  await q`
    CREATE TABLE IF NOT EXISTS shop_profile (
      id            INT PRIMARY KEY DEFAULT 1,
      business_name TEXT NOT NULL,
      category      TEXT NOT NULL,
      description   TEXT NOT NULL,
      city          TEXT,
      language      TEXT NOT NULL DEFAULT 'TAMIL',
      image_url     TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT shop_profile_single_row CHECK (id = 1)
    )
  `;

  await q`
    CREATE TABLE IF NOT EXISTS daily_post (
      id           BIGSERIAL PRIMARY KEY,
      headline     TEXT NOT NULL,
      primary_text TEXT NOT NULL,
      cta          TEXT NOT NULL,
      image_url    TEXT,
      -- PENDING: generated, waiting for the owner.
      -- POSTED:  live on Instagram.
      -- SKIPPED: the owner rejected it.
      -- FAILED:  Instagram refused it; see error.
      status       TEXT NOT NULL DEFAULT 'PENDING',
      error        TEXT,
      instagram_id TEXT,
      permalink    TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      posted_at    TIMESTAMPTZ
    )
  `;

  // Added after the table shipped, so ALTER rather than a changed CREATE --
  // an existing deployment already has rows. IF NOT EXISTS keeps it safe to
  // run on every request alongside the rest of ensureSchema.
  await q`ALTER TABLE daily_post ADD COLUMN IF NOT EXISTS hook TEXT`;
  await q`ALTER TABLE daily_post ADD COLUMN IF NOT EXISTS hashtags TEXT[]`;
  await q`ALTER TABLE daily_post ADD COLUMN IF NOT EXISTS theme TEXT`;
  /// The day this post is meant to go out. Null on rows written before the
  /// calendar existed, which is why every read coalesces it to created_at.
  await q`ALTER TABLE daily_post ADD COLUMN IF NOT EXISTS scheduled_for DATE`;

  // One row, like shop_profile, for the same reason and with the same
  // constraint forcing the multi-tenant change to be noticed.
  await q`
    CREATE TABLE IF NOT EXISTS meta_connection (
      id                 INT PRIMARY KEY DEFAULT 1,
      page_id            TEXT NOT NULL,
      page_name          TEXT,
      -- AES-256-GCM ciphertext, never the raw token. A Page access token
      -- derived from a long-lived user token does not expire, which is why
      -- there is no refresh column: there is nothing to refresh.
      page_token_enc     TEXT NOT NULL,
      instagram_user_id  TEXT,
      ad_account_id      TEXT,
      ad_account_name    TEXT,
      connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT meta_connection_single_row CHECK (id = 1)
    )
  `;

  // The queue is read as "the newest pending one" on every load, and the
  // cron checks "did we already make one today" before generating.
  await q`
    CREATE INDEX IF NOT EXISTS daily_post_status_created
      ON daily_post (status, created_at DESC)
  `;
}

export interface ShopProfile {
  business_name: string;
  category: string;
  description: string;
  city: string | null;
  language: string;
  image_url: string | null;
}

export interface DailyPost {
  id: string;
  hook: string | null;
  hashtags: string[] | null;
  theme: string | null;
  scheduled_for: string | null;
  headline: string;
  primary_text: string;
  cta: string;
  image_url: string | null;
  status: string;
  error: string | null;
  permalink: string | null;
  created_at: string;
  posted_at: string | null;
}

export async function getProfile(): Promise<ShopProfile | null> {
  const rows = (await sql()`
    SELECT business_name, category, description, city, language, image_url
    FROM shop_profile WHERE id = 1
  `) as ShopProfile[];
  return rows[0] ?? null;
}

export async function saveProfile(p: ShopProfile): Promise<void> {
  await sql()`
    INSERT INTO shop_profile
      (id, business_name, category, description, city, language, image_url, updated_at)
    VALUES
      (1, ${p.business_name}, ${p.category}, ${p.description}, ${p.city},
       ${p.language}, ${p.image_url}, now())
    ON CONFLICT (id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      category      = EXCLUDED.category,
      description   = EXCLUDED.description,
      city          = EXCLUDED.city,
      language      = EXCLUDED.language,
      image_url     = EXCLUDED.image_url,
      updated_at    = now()
  `;
}

/** True when a post was already generated today, in the shop's own timezone. */
export async function hasPostForToday(timeZone: string): Promise<boolean> {
  const rows = (await sql()`
    SELECT 1 FROM daily_post
    WHERE (created_at AT TIME ZONE ${timeZone})::date
        = (now() AT TIME ZONE ${timeZone})::date
    LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

export async function createPost(p: {
  hook?: string | null;
  headline: string;
  primaryText: string;
  cta: string;
  hashtags?: string[];
  theme?: string | null;
  /** ISO date, e.g. 2026-08-04. Null means "as soon as approved". */
  scheduledFor?: string | null;
  imageUrl: string | null;
  status: string;
}): Promise<string> {
  const rows = (await sql()`
    INSERT INTO daily_post
      (hook, headline, primary_text, cta, hashtags, theme, scheduled_for,
       image_url, status)
    VALUES
      (${p.hook ?? null}, ${p.headline}, ${p.primaryText}, ${p.cta},
       ${p.hashtags ?? []}, ${p.theme ?? null}, ${p.scheduledFor ?? null},
       ${p.imageUrl}, ${p.status})
    RETURNING id
  `) as Array<{ id: string }>;
  return String(rows[0].id);
}

/** True when the calendar already covers this date. */
export async function hasPostForDate(date: string): Promise<boolean> {
  const rows = (await sql()`
    SELECT 1 FROM daily_post WHERE scheduled_for = ${date}::date LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

export async function listRecentPosts(limit = 20): Promise<DailyPost[]> {
  return (await sql()`
    SELECT id, hook, headline, primary_text, cta, hashtags, theme,
           scheduled_for, image_url, status, error, permalink, created_at,
           posted_at
    FROM daily_post
    -- Scheduled order, not insertion order: a week generated in one call
    -- shares a created_at, and the owner reads it as a calendar.
    ORDER BY COALESCE(scheduled_for, created_at::date) DESC, id DESC
    LIMIT ${limit}
  `) as DailyPost[];
}

export async function getPost(id: string): Promise<DailyPost | null> {
  const rows = (await sql()`
    SELECT id, hook, headline, primary_text, cta, hashtags, theme,
           scheduled_for, image_url, status, error, permalink, created_at,
           posted_at
    FROM daily_post WHERE id = ${id}
  `) as DailyPost[];
  return rows[0] ?? null;
}

export async function markPosted(
  id: string,
  instagramId: string,
  permalink: string | null,
): Promise<void> {
  await sql()`
    UPDATE daily_post
    SET status = 'POSTED', instagram_id = ${instagramId},
        permalink = ${permalink}, posted_at = now(), error = NULL
    WHERE id = ${id}
  `;
}

export async function markFailed(id: string, error: string): Promise<void> {
  await sql()`
    UPDATE daily_post SET status = 'FAILED', error = ${error} WHERE id = ${id}
  `;
}

export async function markSkipped(id: string): Promise<void> {
  await sql()`
    UPDATE daily_post SET status = 'SKIPPED' WHERE id = ${id}
  `;
}


/* ---------------- Meta connection ---------------- */

export interface MetaConnectionRow {
  page_id: string;
  page_name: string | null;
  page_token_enc: string;
  instagram_user_id: string | null;
  ad_account_id: string | null;
  ad_account_name: string | null;
  connected_at: string;
}

export async function getConnection(): Promise<MetaConnectionRow | null> {
  const rows = (await sql()`
    SELECT page_id, page_name, page_token_enc, instagram_user_id,
           ad_account_id, ad_account_name, connected_at
    FROM meta_connection WHERE id = 1
  `) as MetaConnectionRow[];
  return rows[0] ?? null;
}

export async function saveConnection(c: {
  pageId: string;
  pageName: string | null;
  pageTokenEnc: string;
  instagramUserId: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
}): Promise<void> {
  await sql()`
    INSERT INTO meta_connection
      (id, page_id, page_name, page_token_enc, instagram_user_id,
       ad_account_id, ad_account_name, connected_at)
    VALUES
      (1, ${c.pageId}, ${c.pageName}, ${c.pageTokenEnc}, ${c.instagramUserId},
       ${c.adAccountId}, ${c.adAccountName}, now())
    ON CONFLICT (id) DO UPDATE SET
      page_id           = EXCLUDED.page_id,
      page_name         = EXCLUDED.page_name,
      page_token_enc    = EXCLUDED.page_token_enc,
      instagram_user_id = EXCLUDED.instagram_user_id,
      ad_account_id     = EXCLUDED.ad_account_id,
      ad_account_name   = EXCLUDED.ad_account_name,
      connected_at      = now()
  `;
}

export async function deleteConnection(): Promise<void> {
  await sql()`DELETE FROM meta_connection WHERE id = 1`;
}
