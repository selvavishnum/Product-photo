import { timingSafeEqual } from 'node:crypto';

/**
 * A passcode gate on the endpoints that can spend money.
 *
 * This is not a login system and does not pretend to be one. It exists
 * because of a specific, concrete hazard: once META_ACCESS_TOKEN is set in
 * the deployment's environment, the publish endpoint can create campaigns on
 * a real ad account with a real payment method attached. The site is public.
 * Without a gate, anyone who finds the URL can spend the shop's budget.
 *
 * Scoped deliberately to publishing. `/ad/generate` is not gated: it spends
 * Gemini quota, not rupees, and gating it would put a passcode in front of
 * the thing people are meant to try.
 *
 * This is the single-operator stopgap. When the app serves other businesses,
 * it is replaced by real authentication and per-user tokens -- at which point
 * the publish route asks the session who the user is instead of asking this.
 */

export const PASSCODE_HEADER = 'x-owner-passcode';
export const PASSCODE_COOKIE = 'owner_passcode';

export type GateResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

/** Constant-time compare, so a wrong passcode leaks nothing through timing. */
function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself be a
  // timing signal, so length is folded into the result instead.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function checkOwner(request: Request): GateResult {
  const expected = process.env.OWNER_PASSCODE;

  // Fail closed. An unset passcode must never mean "let everyone through" --
  // that is exactly the misconfiguration this guards against, and it would be
  // silent.
  if (!expected || expected.length < 8) {
    return {
      ok: false,
      status: 503,
      message:
        'Publishing is disabled: OWNER_PASSCODE is not set (minimum 8 characters).',
    };
  }

  const header = request.headers.get(PASSCODE_HEADER);
  const cookie = readCookie(request.headers.get('cookie'), PASSCODE_COOKIE);
  const provided = header ?? cookie;

  if (!provided || !matches(provided, expected)) {
    return { ok: false, status: 401, message: 'Wrong passcode.' };
  }

  return { ok: true };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
