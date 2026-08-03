'use client';

import { useEffect, useRef, useState } from 'react';

import { SCENES } from '../../lib/scenes';
import { inputClass } from './step-shell';

/**
 * "Make the photo look professional."
 *
 * A shop photo taken on a counter next to a calculator is the single biggest
 * difference between an ad that looks like a business and one that looks like
 * a classified. This keeps the product and repaints everything around it.
 *
 * The result replaces the uploaded photo for everything downstream -- the
 * poster, the share, Instagram, the paid ad -- so the owner picks a background
 * once and the rest of the flow is unchanged.
 */
export default function StudioShot({
  image,
  original,
  passcode,
  onPasscode,
  onImage,
}: {
  /** The photo currently in use, generated or not. */
  image: File | null;
  /** The photo the owner actually uploaded, kept so Undo has something to go back to. */
  original: File | null;
  passcode: string;
  onPasscode: (value: string) => void;
  onImage: (image: File) => void;
}) {
  const [scene, setScene] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  if (!original) return null;

  async function run(key: string) {
    if (!original) return;
    setBusy(true);
    setError(null);
    setScene(key);
    try {
      const form = new FormData();
      // Always the original. Restyling a restyled photo compounds whatever the
      // model got wrong the first time, and after three goes the product is
      // no longer the one in the shop.
      form.set('image', original);
      form.set('scene', key);
      if (note.trim()) form.set('note', note.trim());

      const res = await fetch('/api/v1/product-shot', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not restyle the photo.');
        return;
      }

      const blob = await (await fetch(data.image as string)).blob();
      const file = new File([blob], 'studio.png', { type: blob.type });

      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview(url);
      onImage(file);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    if (!original) return;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
    setScene(null);
    onImage(original);
  }

  const changed = image !== original;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">Make the photo look professional</h2>
      <p className="mt-1 text-sm text-muted">
        Your product stays exactly as it is — only the background and the light
        change.
      </p>

      {preview && (
        <div className="mt-4 overflow-hidden rounded-3xl border border-line bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Restyled product photo" className="block w-full" />
        </div>
      )}

      <input
        className={`${inputClass} mt-4`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What is it? e.g. brass lamp (optional)"
        maxLength={200}
      />

      <input
        className={`${inputClass} mt-3`}
        type="password"
        value={passcode}
        onChange={(e) => onPasscode(e.target.value)}
        placeholder="Owner passcode"
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {SCENES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => run(s.key)}
            disabled={busy || passcode.length === 0}
            aria-pressed={s.key === scene}
            className={`rounded-2xl border px-2 py-3 text-xs font-medium transition disabled:opacity-25 ${
              s.key === scene ? 'border-line-strong bg-surface' : 'border-line'
            }`}
          >
            {busy && s.key === scene ? 'Making…' : s.name}
            <span className="mt-0.5 block text-[11px] text-muted">{s.tamil}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {changed && (
        <button
          type="button"
          onClick={undo}
          className="mt-3 w-full rounded-full border border-line px-6 py-3 text-sm font-medium text-muted"
        >
          Use my original photo instead
        </button>
      )}

      <p className="mt-3 text-xs text-faint">
        Each background costs a few paise on your Gemini key. The words on the
        poster are still drawn by the app, so the Tamil comes out right.
      </p>
    </section>
  );
}
