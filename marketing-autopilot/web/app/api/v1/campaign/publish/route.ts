import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  MetaConfigError,
  getMetaCredentials,
} from '../../../../../lib/metaCredentials';
import {
  MetaApiError,
  findCityKey,
  publishCampaign,
} from '../../../../../lib/metaPublish';
import {
  MIN_DAILY_BUDGET_INR,
  campaignName,
  normaliseCta,
  objectiveForCta,
  pickCopy,
  toPaise,
} from '../../../../../lib/planToPublish';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * POST /api/v1/campaign/publish
 *
 * Creates the campaign, ad set, creative and ad on Meta -- **paused**.
 *
 * Nothing here starts spending. The campaign appears in Ads Manager where the
 * owner reviews the targeting and the copy and turns it on themselves. For a
 * first campaign that separation is worth more than the convenience of a
 * one-tap launch: the cost of a wrong targeting spec going live unattended is
 * real money, and it is not our money.
 */

// Node, not Edge: the Meta SDK is a Node library.
export const runtime = 'nodejs';

/** Four sequential Graph calls plus an image upload. */
export const maxDuration = 60;

const TargetingSchema = z.object({
  ageMin: z.number().int().min(18).max(65),
  ageMax: z.number().int().min(18).max(65),
  genders: z.array(z.enum(['male', 'female', 'all'])).optional(),
  locationRadiusKm: z.number().int().min(1).max(80),
  locationName: z.string().min(1),
});

const CopySchema = z.object({
  language: z.string().min(1),
  headline: z.string().min(1).max(200),
  primaryText: z.string().min(1).max(1000),
  cta: z.string().min(1).max(60),
});

const BodySchema = z.object({
  businessName: z.string().min(1).max(120),
  language: z.string().min(1).max(20),
  dailyBudgetInr: z.coerce.number().int().positive(),
  targeting: TargetingSchema,
  copies: z.array(CopySchema).min(1),
  /** Optional precise pin, when the town name is not enough. */
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function budgetCeiling(): number {
  const raw = Number(process.env.MAX_DAILY_BUDGET_INR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
}

function fail(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, ...extra } }, { status });
}

export async function POST(request: Request) {
  // Gate first, before anything is parsed or any Graph call is made. This is
  // the endpoint that can spend money.
  const gate = checkOwner(request);
  if (!gate.ok) return fail(gate.message, gate.status);

  let credentials;
  try {
    credentials = getMetaCredentials();
  } catch (err) {
    if (err instanceof MetaConfigError) return fail(err.message, 503);
    throw err;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Expected a form submission', 400);
  }

  const rawPlan = form.get('plan');
  if (typeof rawPlan !== 'string') {
    return fail('Missing the campaign plan', 400);
  }

  let parsedPlan: unknown;
  try {
    parsedPlan = JSON.parse(rawPlan);
  } catch {
    return fail('Campaign plan was not valid JSON', 400);
  }

  const parsed = BodySchema.safeParse(parsedPlan);
  if (!parsed.success) {
    return fail('Invalid campaign plan', 400, { details: parsed.error.issues });
  }
  const body = parsed.data;

  // Re-applied here, not trusted from the generate step. The plan makes a
  // round trip through the browser, so a client could otherwise raise its own
  // spending limit by editing it.
  const ceiling = budgetCeiling();
  if (body.dailyBudgetInr > ceiling) {
    return fail(`Daily budget cannot exceed INR ${ceiling}`, 400);
  }
  if (body.dailyBudgetInr < MIN_DAILY_BUDGET_INR) {
    return fail(
      `Meta requires at least INR ${MIN_DAILY_BUDGET_INR} per day`,
      400,
    );
  }

  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) {
    return fail('An ad needs a product photo. Go back and add one.', 400);
  }
  if (!image.type.startsWith('image/')) {
    return fail('Uploaded file must be an image', 400);
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return fail('Image must be under 10 MB', 413);
  }
  const imageBytes = Buffer.from(await image.arrayBuffer());

  const copy = pickCopy(body.copies, body.language);
  const cta = normaliseCta(copy.cta, Boolean(credentials.phoneNumber));
  const objective = objectiveForCta(cta);

  // Meta's own location database, rather than a third-party geocoder: the
  // owner types a town name they know, and Meta matches it against the same
  // data it targets with.
  let city: { key: string; name: string } | null;
  try {
    city = await findCityKey(
      credentials.accessToken,
      body.targeting.locationName,
    );
  } catch (err) {
    // A credentials or connectivity failure here must not be reported as
    // "unknown town" -- see findCityKey.
    if (err instanceof MetaApiError) {
      console.error('geo lookup failed', err.stage, err.detail);
      return fail(err.message, 502, { stage: err.stage });
    }
    throw err;
  }

  if (!city && body.latitude === undefined) {
    return fail(
      `Meta does not recognise "${body.targeting.locationName}" as a place to advertise. ` +
        'Try the nearest larger town.',
      400,
    );
  }

  try {
    const result = await publishCampaign({
      accessToken: credentials.accessToken,
      adAccountId: credentials.adAccountId,
      pageId: credentials.pageId,

      campaignName: campaignName(body.businessName, copy.headline),
      objective,
      dailyBudgetMinor: toPaise(body.dailyBudgetInr),

      targeting: {
        cityKey: city?.key,
        latitude: city ? undefined : body.latitude,
        longitude: city ? undefined : body.longitude,
        radiusKm: body.targeting.locationRadiusKm,
        ageMin: body.targeting.ageMin,
        ageMax: body.targeting.ageMax,
        genders: body.targeting.genders,
      },

      creative: {
        headline: copy.headline,
        primaryText: copy.primaryText,
        cta,
        imageBytes,
        linkUrl:
          objective === 'OUTCOME_TRAFFIC'
            ? `https://facebook.com/${credentials.pageId}`
            : undefined,
        phoneNumber: credentials.phoneNumber,
      },

      // Never true. Going live is a decision the owner makes in Ads Manager,
      // looking at the real campaign, not a checkbox in a wizard.
      activate: false,
    });

    return NextResponse.json({
      ...result,
      matchedLocation: city?.name ?? null,
      cta,
      objective,
      note:
        'Created and PAUSED. Open Meta Ads Manager, check the targeting and the ' +
        'wording, then switch it on there when you are happy.',
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error('publish failed', err.stage, err.detail);
      return fail(err.message, err.detail.isPolicy ? 422 : 502, {
        stage: err.stage,
        // Surfaced because the owner has to act on it: a policy rejection
        // means rewriting the ad, and Meta's own wording says what to change.
        isPolicy: err.detail.isPolicy,
        fbtraceId: err.detail.fbtraceId,
      });
    }
    console.error('publish failed', err);
    return fail('Could not publish the campaign. Please try again.', 500);
  }
}
