'use client';

import { useEffect, useRef, useState } from 'react';

import { THEMES, loadImage, renderPoster } from '../../lib/posterCanvas';

/**
 * One day's post, with its poster drawn here rather than fetched.
 *
 * The cron writes the words overnight and cannot draw the picture: the poster
 * needs a text engine that shapes Tamil, which is the browser and not a
 * serverless function. So the artwork is rendered when the owner opens the
 * queue -- which is exactly when they are looking at it anyway -- and travels
 * with the approval.
 *
 * The shop photo is fetched through the app's own origin rather than used
 * directly. A canvas that has drawn a cross-origin image is tainted and
 * `toBlob` throws, so the poster would render on screen and then fail to
 * export, which is the worst shape a bug can take.
 */

export interface QueuedPost {
  id: string;
  hook: string | null;
  headline: string;
  primary_text: string;
  cta: string;
  hashtags: string[] | null;
  theme: string | null;
  scheduled_for: string | null;
  image_url: string | null;
  status: string;
  error: string | null;
  permalink: string | null;
  created_at: string;
}

function formatDay(iso: string | null, createdAt: string): string {
  const date = new Date(iso ?? createdAt);
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const dayMs = 86_400_000;
  const startOf = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((startOf(date) - startOf(today)) / dayMs);

  // Relative for the days a shop owner is actually planning around; a date
  // for anything further out, where "in 5 days" needs counting.
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function PostCard({
  post,
  passcode,
  busy,
  onApprove,
  onSkip,
}: {
  post: QueuedPost;
  /** The image proxy is gated like everything else that reads shop data. */
  passcode: string;
  busy: boolean;
  onApprove: (poster: File | null) => void;
  onSkip: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      try {
        const theme =
          THEMES.find((t) => t.key === post.theme) ?? THEMES[0];

        let photo = null;
        if (post.image_url) {
          const res = await fetch(
            `/api/v1/image?url=${encodeURIComponent(post.image_url)}`,
            { headers: { 'x-owner-passcode': passcode } },
          );
          if (res.ok) {
            photo = await loadImage(
              new File([await res.blob()], 'photo', {
                type: res.headers.get('content-type') ?? 'image/jpeg',
              }),
            );
          }
        }

        const blob = await renderPoster({
          headline: post.hook || post.headline,
          cta: post.cta,
          theme,
          image: photo,
        });
        if (cancelled) return;

        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        const url = URL.createObjectURL(blob);
        previewUrl.current = url;
        setPreview(url);
        setPoster(new File([blob], `post-${post.id}.png`, { type: 'image/png' }));
      } catch {
        // A poster that will not draw must not hide the words -- they are
        // what is being reviewed, and approving without artwork still works
        // when the profile has a photo.
      }
    }

    void draw();
    return () => {
      cancelled = true;
    };
  }, [
    post.id,
    post.hook,
    post.headline,
    post.cta,
    post.theme,
    post.image_url,
    passcode,
  ]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  return (
    <article className="mt-4 overflow-hidden rounded-3xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-sm font-bold">
          {formatDay(post.scheduled_for, post.created_at)}
        </span>
        <span className="text-xs text-faint">Waiting</span>
      </div>

      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="block w-full" />
      ) : (
        <div className="flex aspect-square items-center justify-center bg-surface text-sm text-muted">
          Drawing the poster…
        </div>
      )}

      <div className="p-5">
        {post.hook && (
          <p className="text-lg font-bold leading-snug">{post.hook}</p>
        )}
        <p className="mt-2 whitespace-pre-line text-ink/75">
          {post.primary_text}
        </p>
        <p className="mt-3 font-semibold">{post.cta}</p>
        {post.hashtags && post.hashtags.length > 0 && (
          <p className="mt-2 text-sm text-brand">
            {post.hashtags.map((t) => `#${t}`).join(' ')}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onApprove(poster)}
            disabled={busy}
            className="rounded-full bg-ink px-5 py-3 font-semibold text-white disabled:opacity-25"
          >
            {busy ? 'Posting…' : 'Post it'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="rounded-full border border-line px-5 py-3 text-muted disabled:opacity-25"
          >
            Skip
          </button>
        </div>
      </div>
    </article>
  );
}
