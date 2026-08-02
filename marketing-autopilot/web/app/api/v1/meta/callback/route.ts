import { NextResponse } from 'next/server';

import { encryptToken, verifyState } from '../../../../../lib/crypto';
import { ensureSchema, saveConnection } from '../../../../../lib/db';
import {
  OAuthError,
  discoverAssets,
  exchangeCode,
  getAppConfig,
  redirectUri,
} from '../../../../../lib/metaOAuth';

/**
 * GET /api/v1/meta/callback
 *
 * Where Meta sends the owner back after they approve.
 *
 * This route cannot use the owner passcode: it is a plain redirect from
 * Meta's servers, with no headers the app controls. Its check is the signed
 * `state` minted by the gated connect route — without it, anyone could arrive
 * here with a code from their own Meta login and attach their ad account to
 * this deployment.
 *
 * Redirects rather than returning JSON, because a person is looking at it.
 * The outcome goes in the query string for /connect to explain.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

function back(request: Request, params: Record<string, string>) {
  const url = new URL('/connect', new URL(request.url).origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // The owner pressed Cancel on Meta's dialog. Not an error -- they changed
  // their mind, and saying "failed" would be wrong.
  const denied = params.get('error');
  if (denied) {
    return back(request, {
      status: 'cancelled',
      message: params.get('error_description') ?? 'Sign-in was cancelled.',
    });
  }

  if (!verifyState(params.get('state'))) {
    // Deliberately vague: a forged or replayed state should not learn whether
    // it failed on the signature or the expiry.
    return back(request, {
      status: 'error',
      message:
        'That sign-in link is no longer valid. Start again from this page.',
    });
  }

  const code = params.get('code');
  if (!code) {
    return back(request, {
      status: 'error',
      message: 'Meta did not send a sign-in code. Try again.',
    });
  }

  try {
    const config = getAppConfig();
    // Must be byte-identical to the one used to start the flow: Meta checks
    // it again at exchange time and rejects a mismatch without saying so.
    const redirect = redirectUri(request);

    const userToken = await exchangeCode(config, redirect, code);
    const assets = await discoverAssets(userToken);

    await ensureSchema();
    await saveConnection({
      pageId: assets.pageId,
      pageName: assets.pageName,
      // The Page token, not the user token, and encrypted before it touches
      // the database. This is the highest-value secret in the system: it
      // authorises spending the owner's advertising budget.
      pageTokenEnc: encryptToken(assets.pageAccessToken),
      instagramUserId: assets.instagramUserId,
      adAccountId: assets.adAccountId,
      adAccountName: assets.adAccountName,
    });

    return back(request, {
      status: 'connected',
      page: assets.pageName,
      instagram: assets.instagramUserId ? 'yes' : 'no',
      ads: assets.adAccountId ? 'yes' : 'no',
    });
  } catch (err) {
    const message =
      err instanceof OAuthError || err instanceof Error
        ? err.message
        : 'Could not finish connecting.';
    console.error('meta oauth callback failed', message);
    return back(request, { status: 'error', message });
  }
}
