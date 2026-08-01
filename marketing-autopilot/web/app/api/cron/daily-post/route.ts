import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  DbNotConfigured,
  createPost,
  ensureSchema,
  getProfile,
  hasPostForToday,
  listRecentPosts,
  markFailed,
  markPosted,
} from '../../../../lib/db';
import { generateDailyPost } from '../../../../lib/dailyPost';
import {
  buildCaption,
  publishInstagramPhoto,
  resolveInstagramUserId,
} from '../../../../lib/instagram';
import { getMetaCredentials } from '../../../../lib/metaCredentials';

/**
 * GET /api/cron/daily-post
 *
 * Writes tomorrow's post. Run once a day by Vercel Cron (see vercel.json).
 *
 * **Generates, does not publish, by default.** A feed of unreviewed
 * AI-written posts is a slow way to damage a business account: Instagram
 * dampens reach on repetitive automated content, and the owner is the one
 * left with a worse Page. So the post lands in a queue and goes live on one
 * tap. Set AUTO_POST=true to skip the tap once you trust it.
 *
 * The shop profile has to be saved once from /queue before this has anything
 * to write about.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Asia/Kolkata: "today" must mean the shop's day, not UTC's. */
const TIME_ZONE = 'Asia/Kolkata';

/**
 * Vercel sets `Authorization: Bearer $CRON_SECRET` on cron invocations. The
 * route is a public URL like any other, so without this anyone could trigger
 * a generation -- and, with AUTO_POST on, a post.
 */
function isAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json(
      { error: { message: 'Unauthorised' } },
      { status: 401 },
    );
  }

  try {
    await ensureSchema();
  } catch (err) {
    if (err instanceof DbNotConfigured) {
      return NextResponse.json({ error: { message: err.message } }, { status: 503 });
    }
    throw err;
  }

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json(
      { skipped: 'No shop profile saved yet. Set one up on /queue.' },
      { status: 200 },
    );
  }

  // Cron can fire more than once -- a retry, a manual trigger, a schedule
  // change -- and two posts in a day is exactly the behaviour that makes an
  // account look automated.
  if (await hasPostForToday(TIME_ZONE)) {
    return NextResponse.json({ skipped: 'Already generated a post today.' });
  }

  // Handed to the model so it does not rewrite the same post it wrote last
  // week. Sameness is the real failure mode of daily generation.
  const recent = await listRecentPosts(14);
  const recentHeadlines = recent.map((p) => p.headline);

  let generated;
  try {
    generated = await generateDailyPost(profile, recentHeadlines);
  } catch (err) {
    console.error('daily post generation failed', err);
    return NextResponse.json(
      { error: { message: err instanceof Error ? err.message : String(err) } },
      { status: 502 },
    );
  }

  const auto = process.env.AUTO_POST === 'true';

  const postId = await createPost({
    headline: generated.headline,
    primaryText: generated.primaryText,
    cta: generated.cta,
    imageUrl: profile.image_url,
    status: 'PENDING',
  });

  if (!auto) {
    return NextResponse.json({
      id: postId,
      status: 'PENDING',
      headline: generated.headline,
      note: 'Waiting for approval on /queue.',
    });
  }

  // Auto mode. A photo is still required -- Instagram will not take a
  // text-only feed post -- so without one the post stays pending rather than
  // failing silently in a job nobody watches.
  if (!profile.image_url) {
    return NextResponse.json({
      id: postId,
      status: 'PENDING',
      note: 'AUTO_POST is on but no photo is saved, so this needs a photo before it can go live.',
    });
  }

  try {
    const credentials = getMetaCredentials();
    const igUserId = await resolveInstagramUserId(
      credentials.accessToken,
      credentials.pageId,
    );
    const result = await publishInstagramPhoto({
      accessToken: credentials.accessToken,
      igUserId,
      imageUrl: profile.image_url,
      caption: buildCaption(
        generated.headline,
        generated.primaryText,
        generated.cta,
      ),
    });
    await markPosted(postId, result.postId, result.permalink ?? null);

    return NextResponse.json({
      id: postId,
      status: 'POSTED',
      permalink: result.permalink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Recorded rather than thrown away: this runs unattended, and a failure
    // nobody can see afterwards is the same as no feature.
    await markFailed(postId, message);
    console.error('auto post failed', message);
    return NextResponse.json(
      { id: postId, status: 'FAILED', error: { message } },
      { status: 502 },
    );
  }
}
