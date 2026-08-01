'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { inputClass } from '../create/step-shell';
import PostCard, { type QueuedPost } from './post-card';

/**
 * The daily-post queue.
 *
 * A post is written for the shop every day and waits here. The owner reads
 * it and taps once — or skips it. That tap is the whole safeguard: a feed of
 * unreviewed AI posts is a slow way to lose reach on a business account, and
 * ten seconds a day is a cheap way not to.
 *
 * Also where the shop profile is set, because the generator needs something
 * to write about when nobody is present to ask.
 */

interface Profile {
  business_name: string;
  category: string;
  description: string;
  city: string | null;
  language: string;
  image_url: string | null;
}

const LANGUAGES = ['TAMIL', 'TANGLISH', 'ENGLISH'];

export default function QueuePage() {
  const [passcode, setPasscode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<QueuedPost[]>([]);
  const [autoPost, setAutoPost] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('TAMIL');
  const [image, setImage] = useState<File | null>(null);

  const load = useCallback(
    async (code: string) => {
      setError(null);
      const res = await fetch('/api/v1/queue', {
        headers: { 'x-owner-passcode': code },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not load the queue.');
        return false;
      }
      setProfile(data.profile);
      setPosts(data.posts ?? []);
      setAutoPost(Boolean(data.autoPost));
      if (data.profile) {
        setBusinessName(data.profile.business_name);
        setCategory(data.profile.category);
        setDescription(data.profile.description);
        setCity(data.profile.city ?? '');
        setLanguage(data.profile.language);
      }
      return true;
    },
    [],
  );

  useEffect(() => {
    // Remembered so the queue is a daily habit, not a daily password prompt.
    const saved = sessionStorage.getItem('owner_passcode');
    if (saved) {
      setPasscode(saved);
      load(saved).then((ok) => setUnlocked(ok));
    }
  }, [load]);

  async function unlock() {
    if (await load(passcode)) {
      sessionStorage.setItem('owner_passcode', passcode);
      setUnlocked(true);
    }
  }

  async function saveProfile() {
    setBusy('profile');
    setError(null);
    try {
      const form = new FormData();
      form.set('action', 'profile');
      form.set(
        'profile',
        JSON.stringify({
          businessName,
          category,
          description,
          city: city || undefined,
          language,
        }),
      );
      if (image) form.set('image', image);

      const res = await fetch('/api/v1/queue', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not save.');
        return;
      }
      await load(passcode);
    } finally {
      setBusy(null);
    }
  }

  async function act(
    id: string,
    action: 'approve' | 'skip',
    poster?: File | null,
  ) {
    setBusy(id);
    setError(null);
    try {
      const form = new FormData();
      form.set('action', action);
      form.set('id', id);
      // The poster was drawn in this browser; the server has no way to make
      // one, so it travels with the approval.
      if (poster) form.set('image', poster);
      const res = await fetch('/api/v1/queue', {
        method: 'POST',
        headers: { 'x-owner-passcode': passcode },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) setError(data?.error?.message ?? 'Failed.');
      await load(passcode);
    } finally {
      setBusy(null);
    }
  }

  if (!unlocked) {
    return (
      <main className="mx-auto max-w-md px-5 pt-16">
        <h1 className="text-3xl font-extrabold tracking-tight">Daily posts</h1>
        <p className="mt-2 text-muted">தினசரி பதிவுகள்</p>
        <input
          className={`${inputClass} mt-8`}
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && unlock()}
          placeholder="Owner passcode"
        />
        {error && (
          <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={unlock}
          disabled={passcode.length === 0}
          className="mt-5 w-full rounded-full bg-ink px-6 py-4 font-semibold text-white disabled:opacity-25"
        >
          Open
        </button>
        <p className="mt-8 text-center text-sm">
          <Link href="/" className="text-muted underline">
            Back to start
          </Link>
        </p>
      </main>
    );
  }

  const pending = posts.filter((p) => p.status === 'PENDING');
  const rest = posts.filter((p) => p.status !== 'PENDING');

  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-16">
      <h1 className="text-3xl font-extrabold tracking-tight">Daily posts</h1>
      <p className="mt-2 text-muted">
        {autoPost
          ? 'Posting automatically each day.'
          : 'One post a day, waiting for your tap.'}
      </p>

      {error && (
        <p className="mt-5 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {/* ---- pending ---- */}
      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">This week</h2>
          <p className="mt-1 text-sm text-muted">
            One post a day, already written. Read it, tap once.
          </p>
          {pending.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              passcode={passcode}
              busy={busy === p.id}
              onApprove={(poster) => act(p.id, 'approve', poster)}
              onSkip={() => act(p.id, 'skip')}
            />
          ))}
        </section>
      )}

      {pending.length === 0 && (
        <p className="mt-8 rounded-3xl bg-surface px-5 py-6 text-center text-sm text-muted">
          Nothing waiting. The next week is written overnight.
        </p>
      )}

      {/* ---- shop profile ---- */}
      <section className="mt-10 rounded-3xl border border-line p-5">
        <h2 className="text-lg font-bold">What to write about</h2>
        <p className="mt-1 text-sm text-muted">
          Saved once. Every daily post is written from this.
        </p>

        <input
          className={`${inputClass} mt-4`}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Shop name"
        />
        <input
          className={`${inputClass} mt-3`}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="What you sell"
        />
        <textarea
          className={`${inputClass} mt-3 min-h-28`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us about the shop — what you sell, who buys it, what makes it worth visiting."
        />
        <input
          className={`${inputClass} mt-3`}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Town"
        />
        <select
          className={`${inputClass} mt-3`}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <div className="mt-3">
          <input
            className={inputClass}
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1.5 text-xs text-faint">
            {profile?.image_url
              ? 'A photo is saved. Attach another to replace it.'
              : 'Instagram needs a photo. JPEG or PNG.'}
          </p>
        </div>

        <button
          type="button"
          onClick={saveProfile}
          disabled={busy === 'profile' || description.trim().length < 10}
          className="mt-5 w-full rounded-full border border-line-strong px-6 py-4 font-semibold disabled:opacity-25"
        >
          {busy === 'profile' ? 'Saving…' : 'Save'}
        </button>
      </section>

      {/* ---- history ---- */}
      {rest.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-bold">Earlier</h2>
          <ul className="mt-3 grid gap-2">
            {rest.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-2xl bg-surface px-4 py-3 text-sm"
              >
                <span>
                  <span className="block font-medium">{p.headline}</span>
                  {p.error && (
                    <span className="text-warn">{p.error}</span>
                  )}
                </span>
                {p.permalink ? (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-success underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="shrink-0 text-faint">
                    {p.status.toLowerCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
