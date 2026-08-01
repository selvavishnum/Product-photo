/**
 * Meta's OAuth flow, and what has to happen after it.
 *
 * The dialog the shop owner sees is Meta's own -- the app only sends them to
 * it and handles what comes back. Getting a usable set of credentials out of
 * one login takes four calls, and the order matters.
 */

const GRAPH = 'https://graph.facebook.com/v24.0';
const DIALOG = 'https://www.facebook.com/v24.0/dialog/oauth';

/**
 * Everything one login has to grant.
 *
 * Facebook Login for Business rather than Instagram Login: the latter is a
 * simpler dialog and needs no Facebook Page, but it cannot grant ads access.
 * This app runs paid campaigns as well as posting, so one dialog has to cover
 * both or the owner signs in twice.
 */
export const SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  // Instagram is reached through the Page, so the Page permissions are not
  // optional even for an Instagram-only user.
  'instagram_basic',
  'instagram_content_publish',
].join(',');

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly stage: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
}

export function getAppConfig(): MetaAppConfig {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();

  const missing = [
    !appId && 'META_APP_ID',
    !appSecret && 'META_APP_SECRET',
  ].filter(Boolean);

  if (missing.length) {
    throw new OAuthError(
      `Connecting Instagram is not configured. Missing: ${missing.join(', ')}. ` +
        'Both are on the Meta app dashboard under Settings -> Basic.',
      'config',
    );
  }
  return { appId: appId!, appSecret: appSecret! };
}

/** Where Meta sends the owner back. Must match the app's Valid OAuth URI. */
export function redirectUri(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/v1/meta/callback`;
}

export function authorizeUrl(
  config: MetaAppConfig,
  redirect: string,
  state: string,
): string {
  const url = new URL(DIALOG);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function graph<T>(url: URL, stage: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });

  // Not every reply is JSON. A proxy, a gateway or an outage answers with
  // HTML, and letting res.json() throw put a raw parser message -- "Unexpected
  // token 'H'..." -- in front of a shop owner as the reason their Instagram
  // would not connect.
  const text = await res.text();
  let body: T & { error?: { message?: string; error_user_msg?: string } };
  try {
    body = JSON.parse(text);
  } catch {
    console.error('non-JSON from Meta', stage, res.status, text.slice(0, 300));
    throw new OAuthError(
      `Could not reach Meta (it answered with ${res.status}). Try again in a moment.`,
      stage,
    );
  }

  if (!res.ok || body.error) {
    throw new OAuthError(
      body.error?.error_user_msg ??
        body.error?.message ??
        `Meta refused the request (${res.status})`,
      stage,
    );
  }
  return body;
}

/**
 * Turns the one-time code into a token that lasts.
 *
 * Two exchanges, not one. The code gives a short-lived token measured in
 * hours; trading it for a long-lived one is what makes the connection survive
 * past the same afternoon. Skipping the second call produces a connection
 * that works in testing and is dead by tomorrow.
 */
export async function exchangeCode(
  config: MetaAppConfig,
  redirect: string,
  code: string,
): Promise<string> {
  const short = new URL(`${GRAPH}/oauth/access_token`);
  short.searchParams.set('client_id', config.appId);
  short.searchParams.set('client_secret', config.appSecret);
  short.searchParams.set('redirect_uri', redirect);
  short.searchParams.set('code', code);

  const { access_token: shortToken } = await graph<{ access_token: string }>(
    short,
    'code_exchange',
  );

  const long = new URL(`${GRAPH}/oauth/access_token`);
  long.searchParams.set('grant_type', 'fb_exchange_token');
  long.searchParams.set('client_id', config.appId);
  long.searchParams.set('client_secret', config.appSecret);
  long.searchParams.set('fb_exchange_token', shortToken);

  const { access_token: longToken } = await graph<{ access_token: string }>(
    long,
    'token_exchange',
  );
  return longToken;
}

export interface DiscoveredAssets {
  pageId: string;
  pageName: string;
  /**
   * The Page's own token, not the user's.
   *
   * Derived from a long-lived user token, a Page token does not expire at
   * all -- which is what removes the refresh job this app has nowhere to run.
   * Publishing uses this, never the user token.
   */
  pageAccessToken: string;
  instagramUserId: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
}

/**
 * Finds the Page, Instagram account and ad account the owner just granted.
 *
 * Asked for rather than configured. These ids are internal numbers a shop
 * owner has no way to look up, and asking them to paste one is asking for a
 * misconfiguration that surfaces days later as a confusing rejection.
 */
export async function discoverAssets(
  userToken: string,
): Promise<DiscoveredAssets> {
  const pagesUrl = new URL(`${GRAPH}/me/accounts`);
  pagesUrl.searchParams.set(
    'fields',
    'id,name,access_token,instagram_business_account{id,username}',
  );
  pagesUrl.searchParams.set('access_token', userToken);

  const pages = await graph<{
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string };
    }>;
  }>(pagesUrl, 'discover_pages');

  const page = pages.data?.[0];
  if (!page) {
    throw new OAuthError(
      'No Facebook Page came back with that login. Ads and Instagram posts ' +
        'both run through a Page, so create one first, then connect again.',
      'discover_pages',
    );
  }

  const accountsUrl = new URL(`${GRAPH}/me/adaccounts`);
  accountsUrl.searchParams.set('fields', 'id,name,account_status');
  accountsUrl.searchParams.set('access_token', userToken);

  let adAccountId: string | null = null;
  let adAccountName: string | null = null;
  try {
    const accounts = await graph<{
      data?: Array<{ id: string; name: string; account_status: number }>;
    }>(accountsUrl, 'discover_ad_accounts');

    // Prefer an active one. An account that cannot run ads is worse than none
    // here: it would be stored, look connected, and fail at publish time.
    const usable =
      accounts.data?.find((a) => a.account_status === 1) ?? accounts.data?.[0];
    adAccountId = usable?.id ?? null;
    adAccountName = usable?.name ?? null;
  } catch {
    // Not fatal. Posting to Instagram works without an ad account, and an
    // owner who only wants that should not be blocked by not having one.
  }

  return {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    instagramUserId: page.instagram_business_account?.id ?? null,
    adAccountId,
    adAccountName,
  };
}
