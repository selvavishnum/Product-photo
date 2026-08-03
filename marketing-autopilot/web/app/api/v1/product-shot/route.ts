import { NextResponse } from 'next/server';

import { resolveUploadedImage } from '../../../../lib/imageBytes';
import { checkOwner } from '../../../../lib/ownerGate';
import {
  ProductShotError,
  generateProductShot,
} from '../../../../lib/productShot';

/**
 * POST /api/v1/product-shot
 *
 * Repaints the background of an uploaded product photo with Nano Banana.
 *
 * Behind the owner passcode. Nothing is published from here, but each call
 * costs real money on the shop's Gemini key, and an open endpoint that runs a
 * paid image model on request is a bill waiting to be run up by anyone who
 * finds the URL.
 */

export const runtime = 'nodejs';

/** Image generation at 2K is slower than text; the Pro model more so. */
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function fail(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) return fail(gate.message, gate.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Expected a form submission', 400);
  }

  const image = form.get('image');
  if (!(image instanceof File)) {
    return fail('Add a product photo first.', 400);
  }

  // Sniffed, not trusted -- same reason as every other upload path here.
  let bytes: Buffer;
  let mimeType: string;
  try {
    const resolved = await resolveUploadedImage(image, MAX_IMAGE_BYTES);
    bytes = resolved.bytes;
    mimeType = resolved.mimeType;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Bad image', 400);
  }

  const scene = form.get('scene');
  const note = form.get('note');

  try {
    const shot = await generateProductShot({
      base64: bytes.toString('base64'),
      mimeType,
      scene: typeof scene === 'string' ? scene : 'studio',
      // Trimmed and capped: it is pasted into the prompt, and an unbounded
      // field there is both a cost and an instruction-injection surface.
      note:
        typeof note === 'string' && note.trim()
          ? note.trim().slice(0, 200)
          : undefined,
    });

    return NextResponse.json({
      // A data URL, so the browser can draw it on the poster canvas without a
      // round trip through storage. Cross-origin images taint the canvas and
      // make toBlob throw; a data URL does not.
      image: `data:${shot.mimeType};base64,${shot.base64}`,
      model: shot.model,
    });
  } catch (err) {
    if (err instanceof ProductShotError) {
      console.error('product shot failed', err.status, err.message);
      return fail(err.message, err.status);
    }
    console.error('product shot failed', err);
    return fail('Could not restyle the photo. Please try again.', 500);
  }
}
