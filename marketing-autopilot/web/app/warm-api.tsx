'use client';

import { useEffect } from 'react';

/**
 * Wakes the API in the background. Renders nothing.
 *
 * The pages are served from Vercel's CDN and appear instantly, but the API
 * runs on Render's free plan, which stops the service after 15 minutes idle
 * and takes roughly 50 seconds to boot again. Left alone, that cold start
 * lands *after* the user presses "Make my ad", on top of the generation
 * itself.
 *
 * Mounting this as early as possible spends that boot against time the user
 * is already using: reading the landing page, then filling in the form.
 * `/api/warmup` is rewritten to the API's `/health` in `next.config.ts`.
 *
 * Deliberately fire-and-forget. This is an optimisation, so a failure here
 * must never surface to the user or block anything -- the real request
 * reports its own problems. The abort on unmount stops a pending request
 * from outliving the page during client-side navigation.
 */
export default function WarmApi() {
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/warmup', { signal: abort.signal }).catch(() => {});
    return () => abort.abort();
  }, []);

  return null;
}
