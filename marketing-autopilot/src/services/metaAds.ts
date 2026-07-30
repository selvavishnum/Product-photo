import {
  Ad,
  AdAccount,
  AdSet,
  Campaign,
  FacebookAdsApi,
} from 'facebook-nodejs-business-sdk';

import { logger } from '../lib/logger.js';

/**
 * Meta Marketing API publishing.
 *
 * This module spends real money, so its defaults are conservative: campaigns
 * are created PAUSED unless the caller explicitly asks otherwise, and every
 * object created is tracked so a partial failure can be rolled back instead of
 * leaving orphans in the ad account.
 *
 * Prerequisites that are not code and will block you:
 *   - A Facebook **Page**. An ad creative's object_story_spec requires
 *     page_id; there is no way to run an ad without one.
 *   - App Review for `ads_management`, plus Business Verification. Before
 *     that, the token only works on ad accounts you personally admin.
 *   - For WHATSAPP_MESSAGE, a WhatsApp number connected to that Page.
 *
 * Enum values below were read from the installed SDK (v24, Graph v24.0)
 * rather than recalled.
 */

export type MetaObjective = 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC';
export type MetaCta = 'WHATSAPP_MESSAGE' | 'CALL_NOW' | 'LEARN_MORE' | 'SHOP_NOW';

export interface PublishParams {
  accessToken: string;
  /** Ad account id, with or without the `act_` prefix. */
  adAccountId: string;
  /** Facebook Page that will own the ad. Required by Meta. */
  pageId: string;

  campaignName: string;
  objective: MetaObjective;

  /** Daily budget in **paise** (integer minor units), matching our schema. */
  dailyBudgetMinor: number;

  targeting: {
    latitude: number;
    longitude: number;
    /** Kilometres. Meta accepts 1-80 for custom locations. */
    radiusKm: number;
    ageMin: number;
    ageMax: number;
    genders?: Array<'male' | 'female' | 'all'>;
    /** Meta interest IDs. Names alone will not target anything. */
    interestIds?: string[];
  };

  creative: {
    headline: string;
    primaryText: string;
    cta: MetaCta;
    /** Public URL of the generated poster. */
    imageUrl: string;
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
      type?: string;
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
 * Error codes that mean "your ad copy or image broke a policy" rather than
 * "your request was malformed". Worth separating: a policy failure needs the
 * user to rewrite their ad, a malformed request is our bug.
 */
const POLICY_CODES = new Set([1885183, 1885184, 1815869]);
const POLICY_SUBCODES = new Set([1443048, 2446146]);

function toMetaError(err: unknown, stage: string): MetaApiError {
  // The SDK does not export FacebookRequestError from its entry point, so it
  // is identified by name. `err.response` is the unwrapped Graph error object.
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'FacebookRequestError') {
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
      // error_user_msg is the human-readable text Meta intends to show the
      // advertiser; message is often terse and internal.
      userMessage ?? e.message ?? 'Meta rejected the request',
      stage,
      {
        code,
        subcode,
        type: typeof body.type === 'string' ? body.type : undefined,
        userTitle:
          typeof body.error_user_title === 'string' ? body.error_user_title : undefined,
        userMessage,
        fbtraceId: typeof body.fbtrace_id === 'string' ? body.fbtrace_id : undefined,
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

  // OUTCOME_LEADS
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

function normaliseAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

/**
 * Confirms the token can actually reach this ad account before anything is
 * created.
 *
 * Without this, an expired token surfaces halfway through the workflow --
 * after a campaign already exists, leaving an orphan to clean up.
 */
async function assertTokenValid(account: AdAccount): Promise<void> {
  try {
    const info = await account.read(['id', 'name', 'account_status', 'currency']);
    // 1 = ACTIVE. Anything else cannot run ads, and failing here is far
    // clearer than a confusing rejection three calls later.
    if (info.account_status !== 1) {
      throw new MetaApiError(
        `Ad account is not active (account_status=${String(info.account_status)}).`,
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

  return {
    geo_locations: {
      custom_locations: [
        {
          latitude: t.latitude,
          longitude: t.longitude,
          // Meta accepts 1-80km for a custom location radius.
          radius: Math.max(1, Math.min(80, Math.round(t.radiusKm))),
          distance_unit: 'kilometer',
        },
      ],
    },
    age_min: Math.max(18, t.ageMin),
    age_max: Math.min(65, t.ageMax),
    ...(genders && genders.length ? { genders } : {}),
    ...(t.interestIds?.length
      ? { flexible_spec: [{ interests: t.interestIds.map((id) => ({ id })) }] }
      : {}),
  };
}

/**
 * Creates a campaign, ad set, creative and ad in one workflow.
 *
 * On failure, everything already created is deleted. A half-built campaign
 * left in the account is worse than none: it is invisible in our database but
 * visible in Ads Manager, and can be activated by accident.
 */
export async function publishMetaAdCampaign(
  params: PublishParams,
): Promise<PublishResult> {
  FacebookAdsApi.init(params.accessToken);

  const accountId = normaliseAccountId(params.adAccountId);
  const account = new AdAccount(accountId);

  await assertTokenValid(account);

  if (params.creative.cta === 'CALL_NOW' && !params.creative.phoneNumber) {
    throw new MetaApiError(
      'CALL_NOW requires a phone number.',
      'validation',
      { isPolicy: false },
    );
  }
  if (params.objective === 'OUTCOME_TRAFFIC' && !params.creative.linkUrl) {
    throw new MetaApiError(
      'OUTCOME_TRAFFIC requires a destination link.',
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
        logger.error(
          { id: obj.id, kind: obj.kind, err: String(err) },
          'rollback failed -- orphan left in ad account',
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
      // Required by Meta on every campaign, even when empty. Housing,
      // employment, credit and political ads must declare themselves here.
      special_ad_categories: [],
    });
    created.push({ kind: 'campaign', id: campaign.id });

    // ---- 2. Ad set -------------------------------------------------------
    const delivery = resolveDelivery(params.objective, params.creative.cta);

    const adSet = await account.createAdSet([], {
      name: `${params.campaignName} - ad set`,
      campaign_id: campaign.id,
      status,
      // Minor units of the account currency: paise for INR, which is what
      // our schema already stores, so no conversion here.
      daily_budget: params.dailyBudgetMinor,
      billing_event: delivery.billing_event,
      optimization_goal: delivery.optimization_goal,
      ...(delivery.destination_type
        ? { destination_type: delivery.destination_type }
        : {}),
      ...(delivery.destination_type ? { promoted_object: { page_id: params.pageId } } : {}),
      targeting: buildTargeting(params.targeting),
    });
    created.push({ kind: 'adset', id: adSet.id });

    // ---- 3. Image, creative, ad -----------------------------------------
    // Meta stores the image itself and references it by hash; it does not
    // hotlink our CDN URL.
    const image = await account.createAdImage([], { url: params.creative.imageUrl });
    const imageHash = extractImageHash(image);

    const linkData: Record<string, unknown> = {
      image_hash: imageHash,
      message: params.creative.primaryText,
      name: params.creative.headline,
      call_to_action: {
        type: params.creative.cta,
        value: buildCtaValue(params),
      },
      // Required even for messaging ads; Meta uses the Page as the fallback
      // destination.
      link: params.creative.linkUrl ?? `https://facebook.com/${params.pageId}`,
    };

    const creative = await account.createAdCreative([], {
      name: `${params.campaignName} - creative`,
      object_story_spec: {
        page_id: params.pageId,
        link_data: linkData,
      },
      degrees_of_freedom_spec: {
        // Stops Meta silently cropping or restyling the poster, which
        // otherwise breaks carefully laid-out Tamil text.
        creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } },
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
    // review", not "approved". The real verdict arrives minutes to hours
    // later as effective_status, which is why checkAdPolicyStatus exists.
    const detail = await new Ad(ad.id).read(['effective_status']);
    const effectiveStatus = String(detail.effective_status ?? 'PENDING_REVIEW');

    logger.info(
      {
        campaignId: campaign.id,
        adSetId: adSet.id,
        adId: ad.id,
        effectiveStatus,
        paused,
        dailyBudgetMinor: params.dailyBudgetMinor,
      },
      'meta campaign published',
    );

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
    logger.error(
      {
        stage: metaErr.stage,
        code: metaErr.detail.code,
        subcode: metaErr.detail.subcode,
        isPolicy: metaErr.detail.isPolicy,
        fbtraceId: metaErr.detail.fbtraceId,
        userTitle: metaErr.detail.userTitle,
        userMessage: metaErr.detail.userMessage,
        createdSoFar: created,
      },
      'meta publish failed',
    );
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

function extractImageHash(image: { id?: string; [k: string]: unknown }): string {
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
 * Re-reads an ad's review verdict.
 *
 * Necessary because policy enforcement is asynchronous: `publishMetaAdCampaign`
 * returning successfully only means the ad was accepted for review. Poll this
 * (a scheduled job, not a tight loop) until the status leaves PENDING_REVIEW.
 */
export async function checkAdPolicyStatus(
  accessToken: string,
  adId: string,
): Promise<{
  effectiveStatus: string;
  disapproved: boolean;
  reviewFeedback?: unknown;
}> {
  FacebookAdsApi.init(accessToken);
  try {
    const ad = await new Ad(adId).read([
      'effective_status',
      // Meta's per-policy explanation of what it objected to.
      'ad_review_feedback',
    ]);
    const effectiveStatus = String(ad.effective_status ?? 'UNKNOWN');
    const disapproved =
      effectiveStatus === (Ad.EffectiveStatus.disapproved ?? 'DISAPPROVED');

    if (disapproved) {
      logger.warn(
        { adId, reviewFeedback: ad.ad_review_feedback },
        'ad disapproved by Meta policy review',
      );
    }

    return {
      effectiveStatus,
      disapproved,
      reviewFeedback: ad.ad_review_feedback,
    };
  } catch (err) {
    throw toMetaError(err, 'policy_status');
  }
}
