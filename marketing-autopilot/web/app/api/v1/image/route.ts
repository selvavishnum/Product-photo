import { NextResponse } from 'next/server';

import { checkOwner } from '../../../../lib/ownerGate';

/**
 * GET /api/v1/image?url=...
 *
 * Re-serves a stored poster photo through this origin.
 *
 * Needed for one specific reason: the queue draws each post's poster on a
 * canvas, and a canvas that has drawn a cross-origin image is tainted --
 * `toBlob` then throws. The poster would appear on screen and fail only when
 * the owner pressed "Post it", which is the worst shape a bug can take.
 *
 * Restricted to the app's own blob store. An open fetch-anything endpoint on
 * a public URL is a server-side request forgery tool, and being useful to us
 * is not a reason to leave one lying around.
 */

export const runtime = 'nodejs';

/** Vercel Blob's public hostname. Anything else is refused. */
const ALLOWED_HOST = /(^|\.)public\.blob\.vercel-storage\.com$/;

export async function GET(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) {
    return NextResponse.json(
      { error: { message: gate.message } },
      { status: gate.status },
    );
  }

  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) {
    return NextResponse.json(
      { error: { message: 'A url is required' } },
      { status: 400 },
    );
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: { message: 'Bad url' } }, { status: 400 });
  }

  if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname)) {
    return NextResponse.json(
      { error: { message: 'That image is not from this app.' } },
      { status: 400 },
    );
  }

  const upstream = await fetch(target, { cache: 'no-store' });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: { message: 'Could not fetch the image.' } },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    return NextResponse.json(
      { error: { message: 'That URL is not an image.' } },
      { status: 400 },
    );
  }

  return new NextResponse(upstream.body, {
    headers: {
      'content-type': contentType,
      // Short: the poster is redrawn on each visit, and a stale photo behind
      // fresh words is worse than a re-fetch.
      'cache-control': 'private, max-age=60',
    },
  });
}
