import type { MetaCta, MetaObjective } from './metaPublish';

/**
 * Bridges what the wizard produces to what Meta requires.
 *
 * These are not the same shape, and the differences are where publishing
 * actually goes wrong:
 *
 *  - The model writes a call to action as free text ("Get Directions").
 *    Meta accepts a fixed enum and rejects anything else.
 *  - The model names interests ("Local Food"). Meta targets numeric interest
 *    ids and silently ignores names. We drop them entirely -- see below.
 *  - The plan has a town name. Meta needs a location it recognises.
 *  - Budget is rupees in the UI and paise everywhere Meta is involved.
 *
 * Keeping this in one file means the mapping is reviewable in one place
 * rather than scattered through the route handler.
 */

/**
 * Free text -> Meta's enum.
 *
 * Ordered most specific first: "message us on whatsapp" contains "message",
 * so a looser rule earlier would swallow it.
 */
export function normaliseCta(raw: string, hasPhone: boolean): MetaCta {
  const t = raw.toLowerCase();

  if (/whats\s*app|message|chat|dm\b/.test(t)) return 'WHATSAPP_MESSAGE';
  if (/call|phone|ring|dial/.test(t)) {
    // Falling back rather than failing: a CALL_NOW ad with no number is
    // rejected by Meta, and losing the exact CTA is better than losing the ad.
    return hasPhone ? 'CALL_NOW' : 'LEARN_MORE';
  }
  if (/shop|buy|order|purchase|book/.test(t)) return 'SHOP_NOW';
  // "Get Directions", "Visit us", anything unrecognised.
  return 'LEARN_MORE';
}

/**
 * Objective follows the call to action.
 *
 * A WhatsApp or phone-call ad is a leads campaign; anything that sends people
 * to a page is traffic. Meta validates objective against optimisation goal,
 * so getting this wrong is a rejection, not a suboptimal campaign.
 */
export function objectiveForCta(cta: MetaCta): MetaObjective {
  return cta === 'WHATSAPP_MESSAGE' || cta === 'CALL_NOW'
    ? 'OUTCOME_LEADS'
    : 'OUTCOME_TRAFFIC';
}

/** Rupees to paise. Meta wants integer minor units of the account currency. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Meta enforces a minimum daily budget per ad set. For INR it is well under
 * the ₹150 the wizard offers as its smallest option, but a hand-edited
 * request could go lower, and the rejection message is not obvious.
 */
export const MIN_DAILY_BUDGET_INR = 100;

/**
 * A campaign name that is useful in Ads Manager six weeks later.
 *
 * The shop owner will look at this list in Meta's own UI, not ours, so it
 * carries the date and what was advertised rather than an opaque id.
 */
export function campaignName(businessName: string, headline: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const subject = headline.trim().slice(0, 40);
  return `${businessName.trim().slice(0, 40)} - ${subject} - ${date}`;
}

/**
 * Picks which of the generated copies actually runs.
 *
 * The model returns several languages. Preferring the one the owner asked for
 * matters more than it looks: an ad written in a language the local audience
 * does not read is a wasted budget, and "first in the array" is not a choice
 * anyone made.
 */
export function pickCopy<T extends { language: string }>(
  copies: T[],
  preferred: string,
): T {
  return copies.find((c) => c.language === preferred) ?? copies[0];
}
