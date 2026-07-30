import crypto from 'node:crypto';

import { env } from '../config/env.js';

const KEY = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard

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
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length <= IV_BYTES + 16) {
    throw new Error('Malformed encrypted token');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = raw.subarray(IV_BYTES + 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}
