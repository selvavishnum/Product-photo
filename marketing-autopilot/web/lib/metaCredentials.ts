/**
 * Where Meta credentials come from.
 *
 * The seam that keeps the single-shop build from becoming a rewrite later.
 * Today there is one shop and its System User token lives in the
 * environment. When the app serves other businesses, each will have its own
 * OAuth token, encrypted at rest in `AdAccountConnection` -- and only this
 * function changes. `publishCampaign` never learns where the token came from.
 *
 * A System User token is used rather than a user token on purpose: it does
 * not expire, so there is no refresh flow to build, and it skips App Review
 * entirely because the token's owner already administers the ad account.
 */

export interface MetaCredentials {
  accessToken: string;
  /** With the `act_` prefix. */
  adAccountId: string;
  pageId: string;
  /** E.164, e.g. +919876543210. Only needed for the CALL_NOW call to action. */
  phoneNumber?: string;
}

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaConfigError';
  }
}

/**
 * Meta rejects an ad account id without the prefix, with an error that does
 * not say so. Cheaper to normalise than to debug.
 */
function normaliseAccountId(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

export function getMetaCredentials(): MetaCredentials {
  const accessToken = process.env.META_ACCESS_TOKEN?.trim();
  const adAccountId = process.env.META_AD_ACCOUNT_ID?.trim();
  const pageId = process.env.META_PAGE_ID?.trim();
  const phoneNumber = process.env.META_PHONE_NUMBER?.trim();

  // Named individually rather than as one "config missing": with three
  // variables that all have to be right, "which one" is the whole question.
  const missing = [
    !accessToken && 'META_ACCESS_TOKEN',
    !adAccountId && 'META_AD_ACCOUNT_ID',
    !pageId && 'META_PAGE_ID',
  ].filter(Boolean);

  if (missing.length) {
    throw new MetaConfigError(
      `Publishing is not configured. Missing: ${missing.join(', ')}.`,
    );
  }

  return {
    accessToken: accessToken!,
    adAccountId: normaliseAccountId(adAccountId!),
    pageId: pageId!,
    phoneNumber: phoneNumber || undefined,
  };
}
