import { createHash } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../config/env.js';
import { upstreamFailed } from '../lib/errors.js';

/**
 * Object storage for generated banners.
 *
 * S3-compatible, so the same code serves AWS S3, Cloudflare R2, Backblaze B2
 * or MinIO -- only the endpoint changes. R2 is the cheap default here: no
 * egress fees, which matters because ad platforms fetch these images
 * repeatedly.
 */
let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
    throw upstreamFailed(
      'Object storage is not configured (S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)',
    );
  }
  client = new S3Client({
    // R2 requires "auto"; real S3 wants a real region.
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    // Path-style avoids needing a wildcard TLS cert per bucket on
    // self-hosted MinIO. R2 and S3 both accept it.
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/**
 * Uploads a PNG and returns its public CDN URL.
 *
 * The key includes a hash of the bytes, so re-rendering identical inputs
 * overwrites the same object instead of accumulating near-duplicates, and the
 * URL can be cached forever -- different content always means a different
 * key.
 */
export async function uploadPoster(
  png: Buffer,
  opts: { campaignId: string; creativeId: string },
): Promise<string> {
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 16);
  const key = `posters/${opts.campaignId}/${opts.creativeId}-${digest}.png`;

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET!,
        Key: key,
        Body: png,
        ContentType: 'image/png',
        // Immutable: the key changes whenever the bytes do.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch (err) {
    throw upstreamFailed(
      'Could not upload the banner to object storage',
      err instanceof Error ? err.message : String(err),
    );
  }

  const base = env.CDN_BASE_URL?.replace(/\/+$/, '');
  return base
    ? `${base}/${key}`
    : `${env.S3_ENDPOINT ?? `https://s3.${env.S3_REGION}.amazonaws.com`}/${env.S3_BUCKET}/${key}`;
}
