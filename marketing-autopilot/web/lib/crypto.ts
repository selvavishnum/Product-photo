import crypto from 'node:crypto';

/**
 * Token encryption and OAuth state signing.
 *
 * A port of `../src/lib/crypto.ts`, for the same reason as the other ports:
 * that file belongs to a package with an env module that throws at import
 * time. The format is byte-identical, so a token encrypted by either side
 * decrypts on the other.
 */

export class CryptoNotConfigured extends Error {
  constructor() {
    super(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    this.name = 'CryptoNotConfigured';
  }
}

/**
 * Derives the AES key from the configured secret.
 *
 * A value that base64-decodes to exactly 32 bytes is used as-is, so keys
 * generated the documented way keep working and previously encrypted tokens
 * stay readable. Anything else is hashed to 32 bytes with SHA-256, which is
 * what makes a host-generated random string usable directly.
 */
function deriveKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new CryptoNotConfigured();

  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length === 32) return decoded;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

/**
 * Encrypts an ad-platform OAuth token for storage.
 *
 * These tokens authorise spending the user's advertising budget, so they are
 * the highest-value secret in the system. AES-256-GCM rather than plain CBC:
 * GCM is authenticated, so a tampered ciphertext fails to decrypt instead of
 * silently producing garbage that gets sent to Meta as a bearer token.
 *
 * Format: base64(iv | authTag | ciphertext) -- self-contained, so rotating
 * storage never needs a second column.
 */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed encrypted token');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/* ---------------- OAuth state ---------------- */

/**
 * Signs the `state` parameter Meta hands back on the callback.
 *
 * The callback is a plain GET from Meta's redirect, so it cannot carry the
 * owner passcode header the rest of the app is gated with. Without a check,
 * anyone could hit the callback with a code from *their own* Meta login and
 * attach their ad account to this deployment.
 *
 * So the state is minted only by the gated connect route and verified here.
 * It carries an expiry because an OAuth redirect that works forever is a
 * link someone can keep.
 */
const STATE_TTL_MS = 10 * 60 * 1000;

export function signState(): string {
  const payload = JSON.stringify({
    nonce: crypto.randomBytes(12).toString('base64url'),
    exp: Date.now() + STATE_TTL_MS,
  });
  const body = Buffer.from(payload).toString('base64url');
  const mac = crypto
    .createHmac('sha256', deriveKey())
    .update(body)
    .digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(state: string | null): boolean {
  if (!state) return false;
  const [body, mac] = state.split('.');
  if (!body || !mac) return false;

  const expected = crypto
    .createHmac('sha256', deriveKey())
    .update(body)
    .digest('base64url');

  // Constant-time, and length-safe: timingSafeEqual throws on a mismatch,
  // which would itself distinguish a wrong-length forgery from a wrong one.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}
