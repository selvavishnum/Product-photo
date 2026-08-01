import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  DbNotConfigured,
  ensureSchema,
  getPost,
  getProfile,
  listRecentPosts,
  markFailed,
  markPosted,
  markSkipped,
  saveProfile,
} from '../../../../lib/db';
import { hostImage } from '../../../../lib/imageHost';
import {
  buildCaption,
  publishInstagramPhoto,
  resolveInstagramUserId,
} from '../../../../lib/instagram';
import {
  MetaConfigError,
  getMetaCredentials,
} from '../../../../lib/metaCredentials';
import { checkOwner } from '../../../../lib/ownerGate';

/**
 * The queue behind the daily-post feature.
 *
 *   GET                    -> the profile and recent posts
 *   POST  action=profile   -> save the shop details the generator writes from
 *   POST  action=approve   -> publish a pending post to Instagram
 *   POST  action=skip      -> discard one
 *
 * One route rather than four: they share the schema check, the owner gate and
 * the same small response shape, and splitting them would spread that across
 * four files without making any of it clearer.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ProfileSchema = z.object({
  businessName: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  description: z.string().min(10).max(4000),
  city: z.string().max(80).optional(),
  language: z.enum(['TAMIL', 'ENGLISH', 'TANGLISH']),
});

function fail(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}

async function withSchema<T>(fn: () => Promise<T>) {
  await ensureSchema();
  return fn();
}

export async function GET(request: Request) {
  const gate = checkOwner(request);
  if (!gate.ok) return fail(gate.message, gate.status);

  try {
    return NextResponse.json(
      await withSchema(async () => ({
        profile: await getProfile(),
        posts: await listRecentPosts(20),
        autoPost: process.env.AUTO_POST === 'true',
      })),
    );
  } catch (err) {
    if (err instanceof DbNotConfigured) return fail(err.message, 503);
    throw err;
  }
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

  const action = form.get('action');

  try {
    await ensureSchema();
  } catch (err) {
    if (err instanceof DbNotConfigured) return fail(err.message, 503);
    throw err;
  }

  /* ---- save the shop profile ---- */
  if (action === 'profile') {
    const raw = form.get('profile');
    if (typeof raw !== 'string') return fail('Missing profile', 400);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return fail('Profile was not valid JSON', 400);
    }

    const parsed = ProfileSchema.safeParse(parsedJson);
    if (!parsed.success) return fail('Invalid profile', 400);

    // The photo is uploaded once and reused for every scheduled post. The
    // alternative -- asking for one each day -- defeats the point of a
    // feature that is supposed to run without anyone present.
    let imageUrl: string | null = null;
    const image = form.get('image');
    if (image instanceof File && image.size > 0) {
      if (image.size > MAX_IMAGE_BYTES) return fail('Photo must be under 8 MB', 413);
      try {
        imageUrl = await hostImage(
          Buffer.from(await image.arrayBuffer()),
          image.type,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Upload failed', 400);
      }
    } else {
      // Keep whatever is already saved rather than clearing it when the form
      // is submitted again without re-attaching the photo.
      imageUrl = (await getProfile())?.image_url ?? null;
    }

    await saveProfile({
      business_name: parsed.data.businessName,
      category: parsed.data.category,
      description: parsed.data.description,
      city: parsed.data.city ?? null,
      language: parsed.data.language,
      image_url: imageUrl,
    });

    return NextResponse.json({ ok: true, imageUrl });
  }

  /* ---- approve or skip a generated post ---- */
  const id = form.get('id');
  if (typeof id !== 'string' || !/^\d+$/.test(id)) {
    return fail('A numeric post id is required', 400);
  }

  if (action === 'skip') {
    await markSkipped(id);
    return NextResponse.json({ ok: true, status: 'SKIPPED' });
  }

  if (action !== 'approve') return fail('Unknown action', 400);

  const post = await getPost(id);
  if (!post) return fail('No such post', 404);
  if (post.status === 'POSTED') return fail('Already posted', 409);
  if (!post.image_url) {
    return fail(
      'This post has no photo. Add one to the shop profile and it will be used from the next post on.',
      400,
    );
  }

  let credentials;
  try {
    credentials = getMetaCredentials();
  } catch (err) {
    if (err instanceof MetaConfigError) return fail(err.message, 503);
    throw err;
  }

  try {
    const igUserId = await resolveInstagramUserId(
      credentials.accessToken,
      credentials.pageId,
    );
    const result = await publishInstagramPhoto({
      accessToken: credentials.accessToken,
      igUserId,
      imageUrl: post.image_url,
      caption: buildCaption(post.headline, post.primary_text, post.cta),
    });
    await markPosted(id, result.postId, result.permalink ?? null);
    return NextResponse.json({
      ok: true,
      status: 'POSTED',
      permalink: result.permalink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Written to the row as well as returned: the owner may close the tab
    // before reading it, and the queue is where they will look next.
    await markFailed(id, message);
    console.error('queue approve failed', message);
    return NextResponse.json({ error: { message } }, { status: 502 });
  }
}
