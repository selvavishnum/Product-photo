import { NextResponse } from 'next/server';

import { DbNotConfigured, ensureSchema, getConnection } from '../../../../../lib/db';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * GET /api/v1/meta/status
 *
 * What is connected, in the terms the owner recognises -- Page name, whether
 * Instagram came with it, which ad account. Never the token.
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

  // The environment-variable route is still valid; the page says so rather
  // than claiming nothing is set up.
  const envFallback = Boolean(process.env.META_ACCESS_TOKEN);

  try {
    await ensureSchema();
    const c = await getConnection();
    return NextResponse.json({
      connected: c !== null,
      pageName: c?.page_name ?? null,
      hasInstagram: Boolean(c?.instagram_user_id),
      adAccountName: c?.ad_account_name ?? null,
      hasAdAccount: Boolean(c?.ad_account_id),
      connectedAt: c?.connected_at ?? null,
      needsDatabase: false,
      envFallback,
    });
  } catch (err) {
    if (err instanceof DbNotConfigured) {
      // Answered, not refused. A missing database is a setup step, not a
      // rejected passcode -- and returning 503 here left the connect page
      // stuck behind its passcode box showing a database error, which looks
      // exactly like the passcode was wrong. 200 lets the page open and say
      // which step is left.
      return NextResponse.json({
        connected: false,
        pageName: null,
        hasInstagram: false,
        adAccountName: null,
        hasAdAccount: false,
        connectedAt: null,
        needsDatabase: true,
        envFallback,
      });
    }
    throw err;
  }
}
