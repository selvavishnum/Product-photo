'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { inputClass } from '../create/step-shell';

/**
 * Connect the shop's Facebook Page and Instagram.
 *
 * One button. The dialog it opens is Meta's own -- the app only mints the
 * signed link and handles what comes back -- which is why there is nothing
 * here that looks like a sign-in form. Asking for a Meta password in our own
 * UI would be both a phishing pattern and a fast way to get the account
 * banned.
 *
 * This replaces pasting a System User token and three ids into environment
 * variables. That still works, and the page says so, but it is a sequence of
 * steps in Business Settings where one wrong permission surfaces days later
 * as a confusing rejection.
 */

interface Status {
  connected: boolean;
  pageName: string | null;
  hasInstagram: boolean;
  adAccountName: string | null;
  hasAdAccount: boolean;
  /** No Postgres store yet, so a connection has nowhere to be saved. */
  needsDatabase: boolean;
  envFallback: boolean;
}

function ConnectInner() {
  const params = useSearchParams();
  const [passcode, setPasscode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const outcome = params.get('status');
  const outcomeMessage = params.get('message');

  const load = useCallback(async (code: string) => {
    setError(null);
    const res = await fetch('/api/v1/meta/status', {
      headers: { 'x-owner-passcode': code },
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? 'Could not check the connection.');
      return false;
    }
    setStatus(data as Status);
    return true;
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem('owner_passcode');
    if (saved) {
      setPasscode(saved);
      load(saved).then(setUnlocked);
    }
  }, [load]);

  async function unlock() {
    if (await load(passcode)) {
      sessionStorage.setItem('owner_passcode', passcode);
      setUnlocked(true);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/meta/connect', {
        headers: { 'x-owner-passcode': passcode },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Could not start sign-in.');
        return;
      }
      // A full navigation, not a popup: Meta's dialog refuses to render in an
      // iframe, and a popup is what mobile browsers block by default.
      window.location.href = data.url;
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <main className="mx-auto max-w-md px-5 pt-16">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Connect Instagram
        </h1>
        <p className="mt-2 text-muted">இன்ஸ்டாகிராம் இணைக்கவும்</p>
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

  return (
    <main className="mx-auto max-w-md px-5 pt-6 pb-16">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Connect Instagram
      </h1>
      <p className="mt-2 text-muted">
        Sign in once. After that, posts and ads go out on their own.
      </p>

      {outcome === 'connected' && (
        <div className="mt-6 rounded-3xl border border-success/30 bg-success-soft p-5">
          <p className="font-bold text-success">Connected</p>
          <p className="mt-2 text-sm text-ink/75">
            {params.get('page')} is linked
            {params.get('instagram') === 'yes'
              ? ', with its Instagram account'
              : ' — but no Instagram account is attached to it yet'}
            {params.get('ads') === 'yes'
              ? ', and an ad account.'
              : '. No ad account came through, so paid ads are not available yet.'}
          </p>
        </div>
      )}

      {outcome === 'cancelled' && (
        <div className="mt-6 rounded-3xl bg-surface p-5 text-sm text-muted">
          Sign-in was cancelled. Nothing changed.
        </div>
      )}

      {outcome === 'error' && (
        <div className="mt-6 rounded-3xl bg-warn-soft p-5 text-sm text-warn">
          {outcomeMessage ?? 'Could not finish connecting.'}
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}

      {status?.needsDatabase && (
        <div className="mt-6 rounded-3xl bg-warn-soft p-5 text-sm text-warn">
          <p className="font-bold">One step left: add a database</p>
          <p className="mt-2">
            Signing in works, but the connection has nowhere to be saved yet.
            In Vercel open <span className="font-semibold">Storage</span>, create
            a <span className="font-semibold">Postgres</span> store, connect it
            to this project, then redeploy. It sets DATABASE_URL on its own.
          </p>
        </div>
      )}

      <section className="mt-6 rounded-3xl border border-line p-5">
        {status?.connected ? (
          <>
            <p className="font-bold">{status.pageName}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Instagram</dt>
              <dd>{status.hasInstagram ? 'Connected' : 'Not linked to this Page'}</dd>
              <dt className="text-muted">Ad account</dt>
              <dd>{status.adAccountName ?? 'None'}</dd>
            </dl>
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="mt-5 w-full rounded-full border border-line px-6 py-4 font-medium text-muted disabled:opacity-25"
            >
              {busy ? 'Opening…' : 'Connect a different account'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {status?.envFallback
                ? 'Running on the token set in the environment. Signing in ' +
                  'replaces it with a connection you can change from here.'
                : 'Nothing is connected yet.'}
            </p>
            <button
              type="button"
              onClick={connect}
              // Stopped here rather than at the end: without a database the
              // sign-in would go all the way through Meta's dialog and fail
              // on the way back, after the owner had already approved.
              disabled={busy || status?.needsDatabase}
              className="mt-5 w-full rounded-full bg-ink px-6 py-4 text-base font-semibold text-white disabled:opacity-25"
            >
              {busy ? 'Opening…' : 'Connect Instagram'}
            </button>
          </>
        )}
      </section>

      <section className="mt-8 text-sm text-muted">
        <p className="font-semibold text-ink">Before you sign in</p>
        <ul className="mt-2 grid gap-1.5">
          <li>• Your Instagram must be a Business or Creator account.</li>
          <li>• It must be linked to your Facebook Page.</li>
          <li>• Sign in as someone who administers both.</li>
        </ul>
      </section>

      <p className="mt-10 text-center text-sm">
        <Link href="/" className="text-muted underline">
          Back to start
        </Link>
      </p>
    </main>
  );
}

export default function ConnectPage() {
  // useSearchParams needs a Suspense boundary, or the whole route opts out of
  // static rendering and the build says so.
  return (
    <Suspense fallback={null}>
      <ConnectInner />
    </Suspense>
  );
}
