import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ImageHostError,
  assertInstagramFormat,
  hostImage,
} from '../../../../../lib/imageHost';
import {
  InstagramError,
  buildCaption,
  publishInstagramCarousel,
  resolveInstagramUserId,
} from '../../../../../lib/instagram';
import { resolveUploadedImage } from '../../../../../lib/imageBytes';
import {
  MetaConfigError,
  getMetaCredentials,
} from '../../../../../lib/metaCredentials';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * POST /api/v1/instagram/carousel
 *
 * Publishes several images as one swipeable post.
 *
 * Separate from the single-photo route rather than a flag on it: the Graph
 * calls differ at every step -- child containers, a parent container, a
 * different place for the caption -- and folding both into one handler would
 * make the branch that runs depend on how many files were attached.
 */

export const runtime = 'nodejs';

/** Several blob uploads, several containers, then Meta fetching each image. */
export const maxDuration = 120;

const CopySchema = z.object({
  headline: z.string().min(1).max(300),
  primaryText: z.string().min(1).max(2000),
  cta: z.string().min(1).max(100),
  hashtags: z.array(z.string().min(1).max(50)).max(30).optional(),
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SLIDES = 10;

function fail(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, ...extra } }, { status });
}

export async function POST(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) return fail(gate.message, gate.status);

  let credentials;
  try {
    credentials = await getMetaCredentials();
  } catch (err) {
    if (err instanceof MetaConfigError) return fail(err.message, 503);
    throw err;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Expected a form submission', 400);
  }

  const raw = form.get('copy');
  if (typeof raw !== 'string') return fail('Missing the ad copy', 400);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return fail('Ad copy was not valid JSON', 400);
  }

  const parsed = CopySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return fail('Invalid ad copy', 400, { details: parsed.error.issues });
  }

  const files = form.getAll('images').filter((f): f is File => f instanceof File);
  if (files.length < 2) {
    return fail('A carousel needs at least 2 images.', 400);
  }
  if (files.length > MAX_SLIDES) {
    return fail(`Instagram allows at most ${MAX_SLIDES} images.`, 400);
  }

  // Every slide is checked before any of them is uploaded. Hosting three and
  // then rejecting the fourth would leave three orphans in blob storage and a
  // post that never happened.
  const resolved: Array<{ bytes: Buffer; mimeType: string }> = [];
  for (const [index, file] of files.entries()) {
    try {
      const image = await resolveUploadedImage(file, MAX_IMAGE_BYTES);
      assertInstagramFormat(image.mimeType);
      resolved.push(image);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Bad image';
      return fail(`Image ${index + 1}: ${detail}`, 400);
    }
  }

  try {
    const imageUrls: string[] = [];
    for (const image of resolved) {
      imageUrls.push(await hostImage(image.bytes, image.mimeType));
    }

    const igUserId =
      credentials.instagramUserId ??
      (await resolveInstagramUserId(credentials.accessToken, credentials.pageId));

    const result = await publishInstagramCarousel({
      accessToken: credentials.accessToken,
      igUserId,
      imageUrls,
      caption: buildCaption(
        parsed.data.headline,
        parsed.data.primaryText,
        parsed.data.cta,
        parsed.data.hashtags,
      ),
    });

    return NextResponse.json({
      ...result,
      slides: imageUrls.length,
      note: `Posted ${imageUrls.length} slides to your Instagram feed.`,
    });
  } catch (err) {
    if (err instanceof ImageHostError) {
      console.error('carousel image host failed', err.message);
      return fail(err.message, 503);
    }
    if (err instanceof InstagramError) {
      console.error('carousel post failed', err.stage, err.detail);
      return fail(err.message, 502, { stage: err.stage });
    }
    console.error('carousel post failed', err);
    return fail('Could not post the carousel. Please try again.', 500);
  }
}
