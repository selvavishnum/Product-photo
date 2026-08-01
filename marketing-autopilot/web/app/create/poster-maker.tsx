'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  THEMES,
  type PosterTheme,
  loadImage,
  renderPoster,
} from '../../lib/posterCanvas';

/**
 * Turns the generated copy and the product photo into a 1080x1080 poster.
 *
 * Drawn in the browser, so it costs nothing, needs no server and appears
 * instantly. The theme picker is four presets rather than colour controls:
 * a shop owner wants a poster that looks right, not a design tool.
 *
 * The rendered poster replaces the raw photo everywhere downstream -- sharing,
 * Instagram, the paid ad -- because a product snapshot with the offer written
 * on it outperforms the snapshot alone, and it is the same one tap either way.
 */
export default function PosterMaker({
  headline,
  cta,
  image,
  onPoster,
}: {
  headline: string;
  cta: string;
  image: File | null;
  onPoster: (poster: File | null) => void;
}) {
  const [theme, setTheme] = useState<PosterTheme>(THEMES[0]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so a stale preview URL can be revoked when the next render
  // replaces it. Without this every theme change leaks a blob.
  const previewUrl = useRef<string | null>(null);

  const draw = useCallback(
    async (chosen: PosterTheme) => {
      setBusy(true);
      setError(null);
      try {
        const photo = image ? await loadImage(image) : null;
        const blob = await renderPoster({
          headline,
          cta,
          theme: chosen,
          image: photo,
        });

        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        const url = URL.createObjectURL(blob);
        previewUrl.current = url;
        setPreview(url);

        onPoster(
          new File([blob], 'poster.png', { type: 'image/png' }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not draw the poster.');
        onPoster(null);
      } finally {
        setBusy(false);
      }
    },
    [headline, cta, image, onPoster],
  );

  useEffect(() => {
    void draw(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, headline, cta, image]);

  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">Your poster</h2>
      <p className="mt-1 text-sm text-muted">
        Made on your phone — free, and the Tamil comes out right.
      </p>

      <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-surface">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Generated ad poster"
            className="block w-full"
          />
        ) : (
          <div className="flex aspect-square items-center justify-center text-sm text-muted">
            {busy ? 'Drawing…' : 'No poster yet'}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTheme(t)}
            aria-pressed={t.key === theme.key}
            className={`rounded-2xl border px-2 py-3 text-xs font-medium transition ${
              t.key === theme.key
                ? 'border-line-strong bg-surface'
                : 'border-line hover:border-faint'
            }`}
          >
            <span
              aria-hidden
              className="mx-auto mb-2 block h-8 w-8 rounded-full"
              style={{
                background: `linear-gradient(${t.from}, ${t.to})`,
              }}
            />
            {t.name}
          </button>
        ))}
      </div>

      {!image && (
        <p className="mt-3 text-xs text-faint">
          Add a product photo next time for a poster with your product on it.
        </p>
      )}
    </section>
  );
}
