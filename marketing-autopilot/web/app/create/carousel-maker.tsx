'use client';

import { useEffect, useRef, useState } from 'react';

import { SCENES, SLIDES } from '../../lib/scenes';
import { inputClass } from './step-shell';

/**
 * Builds a four-slide Instagram carousel from one product photo.
 *
 * A carousel is the format that earns reach on Instagram: every swipe is
 * another second of attention on the same post, and the algorithm counts it.
 * One photo is not a carousel, so the four slides are four different jobs --
 * hero, close-up, in use, offer -- rather than four goes at the same shot.
 *
 * Slides are generated one request at a time on purpose. Four 2K generations
 * in a single serverless call would run past the function timeout, and this
 * way each slide appears as it lands instead of the owner watching a spinner
 * for a minute with nothing to look at.
 */

interface Slide {
  key: string;
  name: string;
  file: File;
  url: string;
}

export default function CarouselMaker({
  image,
  headline,
  cta,
  primaryText,
  hashtags,
  passcode,
  onPasscode,
}: {
  image: File | null;
  headline: string;
  cta: string;
  primaryText: string;
  hashtags: string[];
  passcode: string;
  onPasscode: (value: string) => void;
}) {
  const [scene, setScene] = useState(SCENES[0].key as string);
  const [withText, setWithText] = useState(true);
  const [note, setNote] = useState('');
  const [slides, setSlides] = useState<Slide[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ permalink?: string; slides: number } | null>(
    null,
  );

  // Every object URL made here, so none of them outlive the component.
  const urls = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    };
  }, []);

  if (!image) return null;

  async function build() {
    if (!image) return;
    setBusy(true);
    setError(null);
    setPosted(null);
    setPostError(null);

    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setSlides([]);

    const made: Slide[] = [];
    try {
      for (const [index, slide] of SLIDES.entries()) {
        setProgress(`Slide ${index + 1} of ${SLIDES.length} — ${slide.name}`);

        const form = new FormData();
        form.set('image', image);
        form.set('scene', scene);
        form.set('slide', slide.key);
        if (note.trim()) form.set('note', note.trim());
        // Only the offer slide carries the words when the model is lettering.
        // Four slides all shouting the same headline is a leaflet, not a
        // carousel, and it gives the model four chances to mis-set the Tamil
        // where one is enough.
        if (withText && slide.key === 'offer') {
          form.set('headline', headline);
          if (cta) form.set('cta', cta);
        }

        const res = await fetch('/api/v1/product-shot', {
          method: 'POST',
          headers: { 'x-owner-passcode': passcode },
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(
            `${slide.name}: ${data?.error?.message ?? 'could not be made.'}`,
          );
          return;
        }

        const blob = await (await fetch(data.image as string)).blob();
        const url = URL.createObjectURL(blob);
        urls.current.push(url);

        made.push({
          key: slide.key,
          name: slide.name,
          file: new File([blob], `slide-${index + 1}.png`, { type: blob.type }),
          url,
        });
        // Set inside the loop so each slide shows the moment it arrives.
        setSlides([...made]);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function post() {
    if (slides.length < 2) return;
    setPosting(true);
    setPostError(null);
    try {
      const form = new FormData();
      form.set(
        'copy',
        JSON.stringify({ headline, primaryText, cta, hashtags }),
      );
      for (const slide of slides) form.append('images', slide.file);

      const res = await fetch('/api/v1/instagram/carousel', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setPostError(data?.error?.message ?? 'Could not post the carousel.');
        return;
      }
      setPosted(data);
    } catch {
      setPostError('Could not reach the server.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">Make a carousel</h2>
      <p className="mt-1 text-sm text-muted">
        Four slides people swipe through — hero, close-up, in use, offer.
      </p>

      {slides.length > 0 && (
        <div className="mt-4 -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2">
          {slides.map((slide) => (
            <figure key={slide.key} className="w-56 shrink-0 snap-start">
              <div className="overflow-hidden rounded-3xl border border-line bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.url} alt={slide.name} className="block w-full" />
              </div>
              <figcaption className="mt-1.5 text-center text-xs text-muted">
                {slide.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {SCENES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScene(s.key)}
            disabled={busy}
            aria-pressed={s.key === scene}
            className={`rounded-2xl border px-2 py-3 text-xs font-medium transition disabled:opacity-25 ${
              s.key === scene ? 'border-line-strong bg-surface' : 'border-line'
            }`}
          >
            {s.name}
            <span className="mt-0.5 block text-[11px] text-muted">{s.tamil}</span>
          </button>
        ))}
      </div>

      <input
        className={`${inputClass} mt-3`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What is it? e.g. brass lamp (optional)"
        maxLength={200}
      />

      <label className="mt-3 flex items-start gap-3 rounded-2xl border border-line px-4 py-3 text-sm">
        <input
          type="checkbox"
          checked={withText}
          onChange={(e) => setWithText(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          Let the AI write the offer onto the last slide
          <span className="mt-0.5 block text-xs text-muted">
            Looks more designed. Read the Tamil before you post it — the model
            sometimes sets vowel marks in the wrong place.
          </span>
        </span>
      </label>

      <input
        className={`${inputClass} mt-3`}
        type="password"
        value={passcode}
        onChange={(e) => onPasscode(e.target.value)}
        placeholder="Owner passcode"
      />

      <button
        type="button"
        onClick={build}
        disabled={busy || passcode.length === 0}
        className="mt-4 w-full rounded-full bg-ink px-6 py-4 font-semibold text-white disabled:opacity-25"
      >
        {progress ?? (slides.length ? 'Make them again' : 'Make 4 slides')}
      </button>

      {error && (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {slides.length >= 2 && (
        <>
          <button
            type="button"
            onClick={post}
            disabled={posting || busy}
            className="mt-3 w-full rounded-full border border-line-strong px-6 py-4 font-semibold disabled:opacity-25"
          >
            {posting ? 'Posting…' : `Post ${slides.length} slides to Instagram`}
          </button>

          {postError && (
            <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
              {postError}
            </p>
          )}

          {posted && (
            <div className="mt-3 rounded-3xl border border-success/30 bg-success-soft p-5 text-sm">
              <p className="font-bold text-success">
                {posted.slides} slides are live.
              </p>
              {posted.permalink && (
                <a
                  href={posted.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block underline"
                >
                  Open the post
                </a>
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-xs text-faint">
        Four slides, so four generations on your Gemini key.
      </p>
    </section>
  );
}
