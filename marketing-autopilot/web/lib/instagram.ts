/**
 * Instagram Content Publishing.
 *
 * Plain fetch rather than the Business SDK: this is two POSTs and a GET, and
 * the SDK's Instagram surface is thinner than its ads one anyway.
 *
 * Requirements that are configuration, not code, and will block you:
 *   - The Instagram account must be **Business or Creator**, not personal.
 *   - It must be linked to a Facebook Page. The API reaches Instagram
 *     *through* the Page; an unlinked account is invisible to it.
 *   - The token needs instagram_basic and instagram_content_publish.
 *
 * App Review is NOT needed to post to an account you administer yourself --
 * the same reason the ads path works with a System User token. Review is
 * what lets you post to *other people's* accounts.
 */

const GRAPH = 'https://graph.facebook.com/v24.0';

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly stage: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'InstagramError';
  }
}

interface GraphError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_user_msg?: string;
    error_user_title?: string;
  };
}

async function graph<T>(
  url: string,
  init: RequestInit,
  stage: string,
): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json()) as T & GraphError;

  if (!res.ok || body.error) {
    const e = body.error;
    throw new InstagramError(
      // error_user_msg is the text Meta intends to show the account owner;
      // message is often terse and internal.
      e?.error_user_msg ?? e?.message ?? `Instagram request failed (${res.status})`,
      stage,
      e,
    );
  }
  return body;
}

/**
 * Finds the Instagram account behind a Facebook Page.
 *
 * The Page id is what the operator knows and can copy from Meta's UI; the
 * Instagram user id is an internal number they have no way to look up. Doing
 * the lookup here means one less opaque value to configure wrongly.
 */
export async function resolveInstagramUserId(
  accessToken: string,
  pageId: string,
): Promise<string> {
  const url = `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(accessToken)}`;
  const body = await graph<{ instagram_business_account?: { id: string } }>(
    url,
    { method: 'GET' },
    'resolve_account',
  );

  const id = body.instagram_business_account?.id;
  if (!id) {
    throw new InstagramError(
      'No Instagram account is linked to this Facebook Page. Link a Business ' +
        'or Creator account in the Page settings, then try again.',
      'resolve_account',
    );
  }
  return id;
}

/**
 * Publishes a single image post.
 *
 * Two steps because Meta requires it: the first creates a "container" and
 * gives Meta time to fetch and process the image, the second makes it live.
 * They are separate calls, and the first succeeding does not mean the second
 * will -- an unreachable image URL fails at publish time, not at creation.
 */
export async function publishInstagramPhoto(params: {
  accessToken: string;
  igUserId: string;
  imageUrl: string;
  caption: string;
}): Promise<{ postId: string; permalink?: string }> {
  const create = new URL(`${GRAPH}/${params.igUserId}/media`);
  create.searchParams.set('image_url', params.imageUrl);
  create.searchParams.set('caption', params.caption);
  create.searchParams.set('access_token', params.accessToken);

  const container = await graph<{ id: string }>(
    create.toString(),
    { method: 'POST' },
    'create_container',
  );

  const publish = new URL(`${GRAPH}/${params.igUserId}/media_publish`);
  publish.searchParams.set('creation_id', container.id);
  publish.searchParams.set('access_token', params.accessToken);

  const post = await graph<{ id: string }>(
    publish.toString(),
    { method: 'POST' },
    'publish',
  );

  // Best effort: the post is already live, so failing to read back its link
  // must not turn a success into an error.
  let permalink: string | undefined;
  try {
    const detail = await graph<{ permalink?: string }>(
      `${GRAPH}/${post.id}?fields=permalink&access_token=${encodeURIComponent(params.accessToken)}`,
      { method: 'GET' },
      'read_permalink',
    );
    permalink = detail.permalink;
  } catch {
    // Ignored on purpose.
  }

  return { postId: post.id, permalink };
}

/** Instagram truncates captions past 2,200 characters and caps hashtags at 30. */
export const CAPTION_LIMIT = 2200;
export const HASHTAG_LIMIT = 30;

/**
 * Assembles a caption from the generated ad copy.
 *
 * Instagram reads differently from a Facebook ad: the headline and body run
 * together as one block, and hashtags do the discovery work that paid
 * targeting does elsewhere. Blank lines between the parts because a single
 * dense paragraph in a feed does not get read.
 */
export function buildCaption(
  headline: string,
  primaryText: string,
  cta: string,
  hashtags: string[] = [],
): string {
  const tags = hashtags
    .slice(0, HASHTAG_LIMIT)
    .map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`))
    .join(' ');

  const caption = [headline, primaryText, cta, tags]
    .filter((part) => part && part.trim().length > 0)
    .join('\n\n');

  return caption.length > CAPTION_LIMIT
    ? `${caption.slice(0, CAPTION_LIMIT - 1)}…`
    : caption;
}
