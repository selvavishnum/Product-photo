import { Worker, type Job } from 'bullmq';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { renderPoster, THEMES, type PosterTheme } from '../services/poster.js';
import { uploadPoster } from '../services/storage.js';

export const POSTER_QUEUE = 'poster';

export interface PosterJobData {
  creativeId: string;
  campaignId: string;
  /** Where to fetch the product image from. */
  productImageUrl: string;
  logoUrl?: string;
  themeKey?: keyof typeof THEMES;
}

/**
 * Fetch with a hard timeout and a size ceiling.
 *
 * These URLs come from user input, so an unbounded fetch is a way to hang a
 * worker forever or exhaust its memory on a multi-gigabyte "image".
 */
async function fetchImage(url: string, maxBytes = 15 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new Error(`Image too large: ${declared} bytes`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Checked again: content-length is a claim, not a guarantee.
  if (buf.length > maxBytes) {
    throw new Error(`Image too large: ${buf.length} bytes`);
  }
  return buf;
}

/**
 * Renders a banner and writes its CDN URL back onto the AdCreative.
 *
 * Runs on a queue rather than inline in the request because the request that
 * triggers it is a user clicking "generate", and a slow object-storage upload
 * should not hold that connection open. The render itself is ~200ms; the
 * upload is the unpredictable part.
 */
export function startPosterWorker(): Worker<PosterJobData> {
  const worker = new Worker<PosterJobData>(
    POSTER_QUEUE,
    async (job: Job<PosterJobData>) => {
      const { creativeId, campaignId, productImageUrl, logoUrl, themeKey } = job.data;

      const creative = await prisma.adCreative.findUnique({
        where: { id: creativeId },
      });
      if (!creative) {
        // Not retryable: the row is gone, so retrying cannot help.
        logger.warn({ creativeId }, 'creative no longer exists, dropping job');
        return;
      }

      const [productImage, logo] = await Promise.all([
        fetchImage(productImageUrl),
        logoUrl ? fetchImage(logoUrl) : Promise.resolve(undefined),
      ]);

      const theme: PosterTheme = THEMES[themeKey ?? 'midnight'] ?? THEMES.midnight!;

      const startedAt = Date.now();
      const png = await renderPoster({
        productImage,
        headline: creative.headline,
        ctaText: creative.cta,
        logo,
        theme,
      });
      const renderMs = Date.now() - startedAt;

      const url = await uploadPoster(png, { campaignId, creativeId });

      await prisma.adCreative.update({
        where: { id: creativeId },
        data: { posterUrl: url },
      });

      logger.info(
        { creativeId, renderMs, totalMs: Date.now() - startedAt, bytes: png.length },
        'poster rendered',
      );
      return { url };
    },
    {
      connection: { url: env.REDIS_URL },
      // Sharp releases the event loop during encode, but each concurrent job
      // still holds a full-size bitmap. Four is comfortable on a 512MB dyno;
      // raise it only alongside the memory limit.
      concurrency: 4,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'poster job failed');
  });

  return worker;
}

// Run standalone: `tsx src/workers/posterWorker.ts`
if (process.argv[1]?.includes('posterWorker')) {
  const worker = startPosterWorker();
  logger.info('poster worker started');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, async () => {
      logger.info(`${signal} received, finishing in-flight jobs`);
      await worker.close();
      process.exit(0);
    });
  }
}
