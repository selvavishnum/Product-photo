import { decryptToken } from './crypto';
import { DbNotConfigured, ensureSchema, getConnection } from './db';

/**
 * Where Meta credentials come from.
 *
 * Two sources, tried in order:
 *
 *  1. **A connection made through the Connect button.** The owner signs in to
 *     Meta once, and the Page token, Instagram id and ad account are
 *     discovered and stored encrypted. Nothing to copy, nothing to paste.
 *  2. **Environment variables.** The original single-shop route, kept because
 *     it works with no database and is the fallback if a connection is
 *     revoked mid-flight.
 *
 * This function is the only thing in the app that knows the difference.
 * `publishCampaign`, `postToInstagram` and the cron never learn where a token
 * came from, which is what made adding OAuth a change to one file.
 *
 * The stored token is a **Page** access token, not a user one. Derived from a
 * long-lived user token, a Page token does not expire -- so there is no
 * refresh job, which matters in an app with nowhere to run one.
 */

export interface MetaCredentials {
  accessToken: string;
  /** With the `act_` prefix. */
  adAccountId: string;
  pageId: string;
  /** E.164, e.g. +919876543210. Only needed for the CALL_NOW call to action. */
  phoneNumber?: string;
  /** Present when it came from a connection; saves a lookup at post time. */
  instagramUserId?: string;
  source: 'connection' | 'environment';
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

function fromEnvironment(): MetaCredentials {
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
      'No Instagram or Facebook account is connected. Open Connect and sign ' +
        `in — or set ${missing.join(', ')} if you would rather configure it ` +
        'by hand.',
    );
  }

  return {
    accessToken: accessToken!,
    adAccountId: normaliseAccountId(adAccountId!),
    pageId: pageId!,
    phoneNumber: phoneNumber || undefined,
    source: 'environment',
  };
}

export async function getMetaCredentials(): Promise<MetaCredentials> {
  try {
    await ensureSchema();
    const connection = await getConnection();

    if (connection) {
      return {
        accessToken: decryptToken(connection.page_token_enc),
        // A connection without an ad account can still post to Instagram.
        // The empty string is caught by publishCampaign's own validation with
        // a message about the ad account, which is the accurate one.
        adAccountId: connection.ad_account_id
          ? normaliseAccountId(connection.ad_account_id)
          : '',
        pageId: connection.page_id,
        instagramUserId: connection.instagram_user_id ?? undefined,
        phoneNumber: process.env.META_PHONE_NUMBER?.trim() || undefined,
        source: 'connection',
      };
    }
  } catch (err) {
    // No database is a normal state for the environment-variable setup, so it
    // falls through rather than failing. A decryption failure does not: that
    // means the key changed and the stored token is unreadable, which the
    // owner has to know about rather than silently fall back from.
    if (!(err instanceof DbNotConfigured)) {
      if (err instanceof Error && /decrypt|Malformed/i.test(err.message)) {
        throw new MetaConfigError(
          'The saved connection cannot be decrypted — TOKEN_ENCRYPTION_KEY has ' +
            'changed since it was stored. Connect again.',
        );
      }
      console.error('connection lookup failed', err);
    }
  }

  return fromEnvironment();
}
