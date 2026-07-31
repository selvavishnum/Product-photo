import {
  Ad,
  AdAccount,
  AdSet,
  Campaign,
  FacebookAdsApi,
} from 'facebook-nodejs-business-sdk';

/**
 * Meta Marketing API publishing.
 *
 * A port of `../../src/services/metaAds.ts` into the Next.js app, for the
 * same reason `adPlan.ts` is: the Express package brings Prisma, pino and an
 * env module that throws at import time, none of which this route needs.
 * Keep the two in step.
 *
 * This module spends real money, so its defaults are conservative: campaigns
 * are created PAUSED unless the caller explicitly asks otherwise, and every
 * object created is tracked so a partial failure rolls back rather than
 * leaving orphans in the ad account.
 *
 * Prerequisites that are not code and will block you:
 *   - A Facebook Page. An ad creative's object_story_spec requires page_id;
 *     there is no way to run an ad without one.
 *   - For WHATSAPP_MESSAGE, a WhatsApp number connected to that Page.
 *   - The token's owner must administer the ad account. A System User token
 *     from the same Business Portfolio satisfies this without App Review.
 */

export type MetaObjective = 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC';
export type MetaCta = 'WHATSAPP_MESSAGE' | 'CALL_NOW' | 'LEARN_MORE' | 'SHOP_NOW';

export interface PublishParams {
  accessToken: string;
  adAccountId: string;
  pageId: string;

  campaignName: string;
  objective: MetaObjective;

  /** Daily budget in **paise** (integer minor units). */
  dailyBudgetMinor: number;

  targeting: {
    /**
     * Meta's own location key, from the adgeolocation search. Preferred over
     * coordinates: the shop owner types a town name they know, and no
     * geocoding service sits in the middle getting it wrong.
     */
    cityKey?: string;
    /** Used when there is no city key -- a precise pin on the shop. */
    latitude?: number;
    longitude?: number;
    /** Kilometres. Meta accepts 1-80. */
    radiusKm: number;
    ageMin: number;
    ageMax: number;
    genders?: Array<'male' | 'female' | 'all'>;
  };

  creative: {
    headline: string;
    primaryText: string;
    cta: MetaCta;
    /** Raw image bytes. Preferred -- needs no public URL, so no storage. */
    imageBytes?: Buffer;
    /** Public URL Meta will fetch. Used when there are no bytes. */
    imageUrl?: string;
    /** Landing page. Required for OUTCOME_TRAFFIC. */
    linkUrl?: string;
    /** E.164 number, required for CALL_NOW. */
    phoneNumber?: string;
  };

  /**
   * Defaults to false -- created PAUSED. Set true only after the user has
   * explicitly confirmed they want to start spending.
   */
  activate?: boolean;
}

export interface PublishResult {
  campaignId: string;
  adSetId: string;
  creativeId: string;
  adId: string;
  imageHash: string;
  /** PENDING_REVIEW immediately after creation, in almost all cases. */
  effectiveStatus: string;
  paused: boolean;
}

/** Meta rejected the request. Carries the fields their errors actually use. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly stage: string,
    readonly detail: {
      code?: number;
      subcode?: number;
      userTitle?: string;
      userMessage?: string;
      fbtraceId?: string;
      isPolicy: boolean;
    },
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/**
 * Codes meaning "your ad copy or image broke a policy" rather than "your
 * request was malformed". Worth separating: a policy failure needs the user
 * to rewrite their ad, a malformed request is our bug.
 */
const POLICY_CODES = new Set([1885183, 1885184, 1815869]);
const POLICY_SUBCODES = new Set([1443048, 2446146]);

function toMetaError(err: unknown, stage: string): MetaApiError {
  // The SDK does not export FacebookRequestError from its entry point, so it
  // is identified by name. `err.response` is the unwrapped Graph error.
  if (
    err &&
    typeof err === 'object' &&
    (err as { name?: string }).name === 'FacebookRequestError'
  ) {
    const e = err as { message?: string; response?: Record<string, unknown> };
    const body = e.response ?? {};
    const code = typeof body.code === 'number' ? body.code : undefined;
    const subcode =
      typeof body.error_subcode === 'number' ? body.error_subcode : undefined;
    const userMessage =
      typeof body.error_user_msg === 'string' ? body.error_user_msg : undefined;

    const isPolicy =
      (code !== undefined && POLICY_CODES.has(code)) ||
      (subcode !== undefined && POLICY_SUBCODES.has(subcode)) ||
      /polic|disapprov|not compliant|advertising standards/i.test(
        `${e.message ?? ''} ${userMessage ?? ''}`,
      );

    return new MetaApiError(
      // error_user_msg is the text Meta intends to show the advertiser;
      // message is often terse and internal.
      userMessage ?? e.message ?? 'Meta rejected the request',
      stage,
      {
        code,
        subcode,
        userTitle:
          typeof body.error_user_title === 'string'
            ? body.error_user_title
            : undefined,
        userMessage,
        fbtraceId:
          typeof body.fbtrace_id === 'string' ? body.fbtrace_id : undefined,
        isPolicy,
      },
    );
  }

  return new MetaApiError(
    err instanceof Error ? err.message : String(err),
    stage,
    { isPolicy: false },
  );
}

/**
 * Objective -> (optimization_goal, billing_event, destination_type).
 *
 * Meta validates this combination and rejects mismatches, so it is a lookup
 * table rather than something assembled ad hoc at the call site. The CTA
 * matters too: a WhatsApp ad and a phone-call ad share an objective but need
 * different optimisation goals and destinations.
 */
function resolveDelivery(objective: MetaObjective, cta: MetaCta) {
  if (objective === 'OUTCOME_TRAFFIC') {
    return {
      optimization_goal: AdSet.OptimizationGoal.link_clicks ?? 'LINK_CLICKS',
      billing_event: AdSet.BillingEvent.impressions ?? 'IMPRESSIONS',
      destination_type: undefined as string | undefined,
    };
  }

  if (cta === 'WHATSAPP_MESSAGE') {
    return {
      optimization_goal: AdSet.OptimizationGoal.conversations ?? 'CONVERSATIONS',
      billing_event: AdSet.BillingEvent.impressions ?? 'IMPRESSIONS',
      destination_type: 'WHATSAPP',
    };
  }
  if (cta === 'CALL_NOW') {
    return {
      optimization_goal: AdSet.OptimizationGoal.quality_call ?? 'QUALITY_CALL',
      billing_event: AdSet.BillingEvent.impressions ?? 'IMPRESSIONS',
      destination_type: 'PHONE_CALL',
    };
  }
  // Leads without a lead form or messaging destination behaves as traffic.
  return {
    optimization_goal: AdSet.OptimizationGoal.link_clicks ?? 'LINK_CLICKS',
    billing_event: AdSet.BillingEvent.impressions ?? 'IMPRESSIONS',
    destination_type: undefined as string | undefined,
  };
}

/**
 * Confirms the token can reach this ad account before anything is created.
 *
 * Without it, a bad token surfaces halfway through -- after a campaign
 * already exists, leaving an orphan to clean up.
 */
async function assertAccountUsable(account: AdAccount): Promise<void> {
  try {
    const info = await account.read(['id', 'name', 'account_status', 'currency']);
    // 1 = ACTIVE. Anything else cannot run ads, and failing here is far
    // clearer than a confusing rejection three calls later.
    if (info.account_status !== 1) {
      throw new MetaApiError(
        `Ad account is not active (account_status=${String(info.account_status)}). ` +
          'Check that a payment method is added and the account is not disabled.',
        'token_validation',
        { isPolicy: false },
      );
    }
  } catch (err) {
    if (err instanceof MetaApiError) throw err;
    throw toMetaError(err, 'token_validation');
  }
}

function buildTargeting(t: PublishParams['targeting']) {
  const genders = t.genders?.includes('all')
    ? undefined
    : t.genders
        ?.map((g) => (g === 'male' ? 1 : g === 'female' ? 2 : 0))
        .filter((g) => g > 0);

  const radius = Math.max(1, Math.min(80, Math.round(t.radiusKm)));

  const geo_locations = t.cityKey
    ? { cities: [{ key: t.cityKey, radius, distance_unit: 'kilometer' }] }
    : {
        custom_locations: [
          {
            latitude: t.latitude,
            longitude: t.longitude,
            radius,
            distance_unit: 'kilometer',
          },
        ],
      };

  return {
    geo_locations,
    age_min: Math.max(18, t.ageMin),
    age_max: Math.min(65, t.ageMax),
    ...(genders && genders.length ? { genders } : {}),
    // Interests are deliberately absent. Meta needs numeric interest IDs, not
    // the names the model produces -- but more importantly, a 3-5km radius on
    // a small daily budget is already a narrow audience, and narrowing it
    // further raises frequency and wastes the budget on the same few people.
  };
}

/**
 * Uploads the creative image and returns its hash.
 *
 * Bytes are preferred over a URL: Meta stores the image itself either way, so
 * a public URL buys nothing except an object store to host it in. `bytes` is
 * a documented parameter of `POST /act_<id>/adimages`, and the SDK passes
 * `params` straight through to that edge (verified in the installed source).
 */
async function uploadImage(
  account: AdAccount,
  creative: PublishParams['creative'],
): Promise<string> {
  const params = creative.imageBytes
    ? { bytes: creative.imageBytes.toString('base64') }
    : { url: creative.imageUrl };

  const image = await account.createAdImage([], params);
  return extractImageHash(image);
}

/**
 * Creates a campaign, ad set, creative and ad in one workflow.
 *
 * On failure, everything already created is deleted. A half-built campaign is
 * worse than none: invisible in our records, visible in Ads Manager, and
 * activatable by accident.
 */
export async function publishCampaign(
  params: PublishParams,
): Promise<PublishResult> {
  FacebookAdsApi.init(params.accessToken);

  const account = new AdAccount(params.adAccountId);
  await assertAccountUsable(account);

  if (params.creative.cta === 'CALL_NOW' && !params.creative.phoneNumber) {
    throw new MetaApiError('CALL_NOW requires a phone number.', 'validation', {
      isPolicy: false,
    });
  }
  if (params.objective === 'OUTCOME_TRAFFIC' && !params.creative.linkUrl) {
    throw new MetaApiError(
      'OUTCOME_TRAFFIC requires a destination link.',
      'validation',
      { isPolicy: false },
    );
  }
  if (!params.creative.imageBytes && !params.creative.imageUrl) {
    throw new MetaApiError(
      'An ad needs an image. Add a product photo and try again.',
      'validation',
      { isPolicy: false },
    );
  }
  if (!params.targeting.cityKey && params.targeting.latitude === undefined) {
    throw new MetaApiError(
      'Could not work out where to advertise. Add your town and try again.',
      'validation',
      { isPolicy: false },
    );
  }

  const paused = params.activate !== true;
  const status = paused ? 'PAUSED' : 'ACTIVE';
  const created: Array<{ kind: string; id: string }> = [];

  const rollback = async () => {
    // Reverse order: an ad set cannot be deleted while its ads exist.
    for (const obj of [...created].reverse()) {
      try {
        if (obj.kind === 'campaign') await new Campaign(obj.id).delete();
        if (obj.kind === 'adset') await new AdSet(obj.id).delete();
      } catch (err) {
        console.error(
          `rollback failed -- orphan ${obj.kind} ${obj.id} left in ad account`,
          err,
        );
      }
    }
  };

  try {
    // ---- 1. Campaign -----------------------------------------------------
    const campaign = await account.createCampaign([], {
      name: params.campaignName,
      objective: params.objective,
      status,
      // Required on every campaign, even when empty. Housing, employment,
      // credit and political ads must declare themselves here.
      special_ad_categories: [],
    });
    created.push({ kind: 'campaign', id: campaign.id });

    // ---- 2. Ad set -------------------------------------------------------
    const delivery = resolveDelivery(params.objective, params.creative.cta);

    const adSet = await account.createAdSet([], {
      name: `${params.campaignName} - ad set`,
      campaign_id: campaign.id,
      status,
      // Minor units of the account currency: paise for INR, which is what we
      // already carry, so no conversion here.
      daily_budget: params.dailyBudgetMinor,
      billing_event: delivery.billing_event,
      optimization_goal: delivery.optimization_goal,
      ...(delivery.destination_type
        ? {
            destination_type: delivery.destination_type,
            promoted_object: { page_id: params.pageId },
          }
        : {}),
      targeting: buildTargeting(params.targeting),
    });
    created.push({ kind: 'adset', id: adSet.id });

    // ---- 3. Image, creative, ad -----------------------------------------
    const imageHash = await uploadImage(account, params.creative);

    const creative = await account.createAdCreative([], {
      name: `${params.campaignName} - creative`,
      object_story_spec: {
        page_id: params.pageId,
        link_data: {
          image_hash: imageHash,
          message: params.creative.primaryText,
          name: params.creative.headline,
          call_to_action: {
            type: params.creative.cta,
            value: buildCtaValue(params),
          },
          // Required even for messaging ads; Meta uses the Page as the
          // fallback destination.
          link:
            params.creative.linkUrl ??
            `https://facebook.com/${params.pageId}`,
        },
      },
      degrees_of_freedom_spec: {
        // Stops Meta silently cropping or restyling the image, which
        // otherwise breaks carefully laid-out Tamil text.
        creative_features_spec: {
          standard_enhancements: { enroll_status: 'OPT_OUT' },
        },
      },
    });
    created.push({ kind: 'creative', id: creative.id });

    const ad = await account.createAd([], {
      name: `${params.campaignName} - ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status,
    });
    created.push({ kind: 'ad', id: ad.id });

    // Policy review is asynchronous: a successful create means "accepted for
    // review", not "approved". The verdict arrives minutes to hours later as
    // effective_status, which is why checkAdStatus exists.
    const detail = await new Ad(ad.id).read(['effective_status']);
    const effectiveStatus = String(detail.effective_status ?? 'PENDING_REVIEW');

    return {
      campaignId: campaign.id,
      adSetId: adSet.id,
      creativeId: creative.id,
      adId: ad.id,
      imageHash,
      effectiveStatus,
      paused,
    };
  } catch (err) {
    const metaErr = err instanceof MetaApiError ? err : toMetaError(err, 'publish');
    console.error('meta publish failed', {
      stage: metaErr.stage,
      code: metaErr.detail.code,
      subcode: metaErr.detail.subcode,
      isPolicy: metaErr.detail.isPolicy,
      fbtraceId: metaErr.detail.fbtraceId,
      createdSoFar: created,
    });
    await rollback();
    throw metaErr;
  }
}

function buildCtaValue(params: PublishParams): Record<string, unknown> {
  switch (params.creative.cta) {
    case 'CALL_NOW':
      return { link: `tel:${params.creative.phoneNumber}` };
    case 'WHATSAPP_MESSAGE':
      return { app_destination: 'WHATSAPP' };
    default:
      return {
        link: params.creative.linkUrl ?? `https://facebook.com/${params.pageId}`,
      };
  }
}

function extractImageHash(image: { [k: string]: unknown }): string {
  // createAdImage returns the hash under a filename-keyed `images` map, and
  // the key is not predictable, so take the first entry.
  const images = image.images as Record<string, { hash?: string }> | undefined;
  if (images) {
    const first = Object.values(images)[0];
    if (first?.hash) return first.hash;
  }
  if (typeof image.hash === 'string') return image.hash;
  throw new MetaApiError(
    'Meta accepted the image but returned no hash.',
    'image_upload',
    { isPolicy: false },
  );
}

/**
 * Resolves a town name to Meta's own location key.
 *
 * Preferred over geocoding: the shop owner types a name they know, Meta
 * matches it against the same database it targets with, and no third-party
 * geocoder sits in between getting Indian town names wrong.
 */
export async function findCityKey(
  accessToken: string,
  query: string,
): Promise<{ key: string; name: string } | null> {
  const url = new URL(
    `https://graph.facebook.com/v24.0/search`,
  );
  url.searchParams.set('type', 'adgeolocation');
  url.searchParams.set('location_types', JSON.stringify(['city']));
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', accessToken);

  const res = await fetch(url);

  // A failed request and an empty result mean different things, and conflating
  // them produces a badly wrong message: with an expired token this call
  // returns 403, and reporting that as "no match" tells the owner their town
  // does not exist when the real problem is their credentials.
  if (!res.ok) {
    const text = await res.text();
    console.error('adgeolocation search failed', res.status, text);
    throw new MetaApiError(
      res.status === 400 || res.status === 401 || res.status === 403
        ? 'Facebook rejected the access token. Check META_ACCESS_TOKEN has not ' +
          'expired and still has ads_management on this ad account.'
        : `Could not reach Facebook to look up the location (HTTP ${res.status}).`,
      'geo_search',
      { isPolicy: false },
    );
  }

  const body = (await res.json()) as {
    data?: Array<{ key?: string; name?: string }>;
  };
  const hit = body.data?.[0];
  // Genuinely no match: the search worked, Meta just does not target this
  // place by name.
  if (!hit?.key) return null;
  return { key: hit.key, name: hit.name ?? query };
}

/**
 * Re-reads an ad's review verdict.
 *
 * Necessary because policy enforcement is asynchronous: publishing
 * successfully only means the ad was accepted for review.
 */
export async function checkAdStatus(
  accessToken: string,
  adId: string,
): Promise<{
  effectiveStatus: string;
  disapproved: boolean;
  reviewFeedback?: unknown;
}> {
  FacebookAdsApi.init(accessToken);
  try {
    const ad = await new Ad(adId).read(['effective_status', 'ad_review_feedback']);
    const effectiveStatus = String(ad.effective_status ?? 'UNKNOWN');
    const disapproved =
      effectiveStatus === (Ad.EffectiveStatus.disapproved ?? 'DISAPPROVED');

    return {
      effectiveStatus,
      disapproved,
      reviewFeedback: ad.ad_review_feedback,
    };
  } catch (err) {
    throw toMetaError(err, 'policy_status');
  }
}
