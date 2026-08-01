import { NextResponse } from 'next/server';

import {
  MetaConfigError,
  getMetaCredentials,
} from '../../../../../lib/metaCredentials';
import { MetaApiError, checkAdStatus } from '../../../../../lib/metaPublish';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * GET /api/v1/campaign/status?adId=...
 *
 * Meta's policy review is asynchronous. Publishing successfully only means
 * the ad was accepted for review -- the verdict lands minutes to hours later
 * as `effective_status`, and a disapproval arrives with no notification we
 * can see. Without this endpoint an owner would believe an ad is fine when
 * Meta has already rejected it.
 *
 * Gated with the rest: an ad id is not secret, but the review feedback
 * describes the account's ads and there is no reason to serve it publicly.
 */

export const runtime = 'nodejs';

/** What each status means to someone who does not use Ads Manager daily. */
const EXPLANATIONS: Record<string, string> = {
  PENDING_REVIEW: 'Meta is still checking the ad. This usually takes under an hour.',
  IN_PROCESS: 'Meta is still checking the ad.',
  DISAPPROVED: 'Meta rejected the ad. Read the reason below and reword it.',
  PAUSED: 'Approved and ready. It is paused — switch it on in Ads Manager to start.',
  ACTIVE: 'Live and spending.',
  CAMPAIGN_PAUSED: 'The ad is fine; the campaign around it is paused.',
  ADSET_PAUSED: 'The ad is fine; the ad set around it is paused.',
  PENDING_BILLING_INFO: 'Add a payment method to the ad account.',
};

export async function GET(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) {
    return NextResponse.json(
      { error: { message: gate.message } },
      { status: gate.status },
    );
  }

  const adId = new URL(request.url).searchParams.get('adId')?.trim();
  if (!adId || !/^\d+$/.test(adId)) {
    return NextResponse.json(
      { error: { message: 'A numeric adId is required' } },
      { status: 400 },
    );
  }

  let credentials;
  try {
    credentials = await getMetaCredentials();
  } catch (err) {
    if (err instanceof MetaConfigError) {
      return NextResponse.json({ error: { message: err.message } }, { status: 503 });
    }
    throw err;
  }

  try {
    const status = await checkAdStatus(credentials.accessToken, adId);
    return NextResponse.json({
      ...status,
      explanation:
        EXPLANATIONS[status.effectiveStatus] ??
        `Meta reports this ad as ${status.effectiveStatus}.`,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error('status check failed', err.stage, err.detail);
      return NextResponse.json({ error: { message: err.message } }, { status: 502 });
    }
    throw err;
  }
}
