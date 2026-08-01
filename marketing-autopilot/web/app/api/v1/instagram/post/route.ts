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
  publishInstagramPhoto,
  resolveInstagramUserId,
} from '../../../../../lib/instagram';
import { resolveUploadedImage } from '../../../../../lib/imageBytes';
import {
  MetaConfigError,
  getMetaCredentials,
} from '../../../../../lib/metaCredentials';
import { checkOwner } from '../../../../../lib/ownerGate';

/**
 * POST /api/v1/instagram/post
 *
 * Publishes the generated ad to the shop's own Instagram feed.
 *
 * Unlike the paid path this spends nothing, but it is still gated: it posts
 * publicly under the owner's name, and an unauthenticated endpoint that can
 * put arbitrary text and images on someone's business account is its own
 * kind of expensive.
 */

export const runtime = 'nodejs';

/** Blob upload, container creation, Meta fetching the image, then publish. */
export const maxDuration = 60;

const BodySchema = z.object({
  headline: z.string().min(1).max(300),
  primaryText: z.string().min(1).max(2000),
  cta: z.string().min(1).max(100),
  hashtags: z.array(z.string().min(1).max(50)).max(30).optional(),
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function fail(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { message, ...extra } }, { status });
}

export async function POST(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) return fail(gate.message, gate.status);

  let credentials;
  try {
    credentials = getMetaCredentials();
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

  const parsed = BodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return fail('Invalid ad copy', 400, { details: parsed.error.issues });
  }

  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) {
    return fail('Instagram needs a photo. Go back and add one.', 400);
  }
  // Sniffed, not trusted: mobile clients send application/octet-stream unless
  // the content type is set explicitly, and rejecting a real JPEG on that
  // basis is a bug the user cannot do anything about.
  let bytes: Buffer;
  let mimeType: string;
  try {
    const resolved = await resolveUploadedImage(image, MAX_IMAGE_BYTES);
    bytes = resolved.bytes;
    mimeType = resolved.mimeType;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Bad image', 400);
  }

  // Instagram is narrower than "any image" -- it refuses GIF and WebP with an
  // error that does not say which part failed, so it is caught here where the
  // user is still looking at the photo they picked.
  try {
    assertInstagramFormat(mimeType);
  } catch (err) {
    return fail(
      err instanceof ImageHostError ? err.message : 'Unsupported image format',
      400,
    );
  }

  try {
    // Instagram fetches `image_url` itself, so the photo has to be reachable
    // on the public internet before the post can be created. This is the one
    // place the app needs an object store.
    const imageUrl = await hostImage(bytes, mimeType);

    const igUserId = await resolveInstagramUserId(
      credentials.accessToken,
      credentials.pageId,
    );

    const caption = buildCaption(
      parsed.data.headline,
      parsed.data.primaryText,
      parsed.data.cta,
      parsed.data.hashtags,
    );

    const result = await publishInstagramPhoto({
      accessToken: credentials.accessToken,
      igUserId,
      imageUrl,
      caption,
    });

    return NextResponse.json({
      ...result,
      note: 'Posted to your Instagram feed.',
    });
  } catch (err) {
    if (err instanceof ImageHostError) {
      console.error('instagram image host failed', err.message);
      return fail(err.message, 503);
    }
    if (err instanceof InstagramError) {
      console.error('instagram post failed', err.stage, err.detail);
      return fail(err.message, 502, { stage: err.stage });
    }
    console.error('instagram post failed', err);
    return fail('Could not post to Instagram. Please try again.', 500);
  }
}
