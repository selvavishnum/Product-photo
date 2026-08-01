import { NextResponse } from 'next/server';

import { CryptoNotConfigured, signState } from '../../../../../lib/crypto';
import {
  OAuthError,
  authorizeUrl,
  getAppConfig,
  redirectUri,
} from '../../../../../lib/metaOAuth';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * GET /api/v1/meta/connect
 *
 * Returns the Meta sign-in URL to send the owner to.
 *
 * Gated, and it mints the signed `state` the callback checks. That is the
 * whole reason this is a separate route rather than a link built in the
 * browser: the callback arrives as a plain redirect from Meta with no headers
 * we control, so the only way it can know the flow started here is a value it
 * can verify.
 */

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) {
    return NextResponse.json(
      { error: { message: gate.message } },
      { status: gate.status },
    );
  }

  try {
    const config = getAppConfig();
    const redirect = redirectUri(request);
    return NextResponse.json({
      url: authorizeUrl(config, redirect, signState()),
      // Echoed so a mismatch is diagnosable: Meta refuses the whole dialog
      // when this is not in the app's Valid OAuth Redirect URIs, and its
      // error does not say which URI it expected.
      redirectUri: redirect,
    });
  } catch (err) {
    if (err instanceof OAuthError || err instanceof CryptoNotConfigured) {
      return NextResponse.json(
        { error: { message: err.message } },
        { status: 503 },
      );
    }
    throw err;
  }
}
