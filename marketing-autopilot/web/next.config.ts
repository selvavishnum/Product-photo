import type { NextConfig } from 'next';

/**
 * No API proxy.
 *
 * `/api/v1/ad/generate` is a route handler in this app (see
 * `app/api/v1/ad/generate/route.ts`), so the site deploys as one thing with
 * no second service behind it. That endpoint only calls Gemini -- no image
 * processing, no database, no ad platform -- so there is nothing it needs
 * that a serverless function cannot provide.
 *
 * The Express app in `../` is still where poster rendering and Meta
 * publishing live. Those genuinely need a long-lived server with system
 * fonts installed, and get an `API_ORIGIN` rewrite added back when they are
 * wired up. Until then, a rewrite pointing at a service that may not exist
 * is a failure waiting to happen, not future-proofing.
 */
const config: NextConfig = {
  // The repo has several package.json files, so Next's workspace-root
  // inference picks the wrong directory and then cannot resolve itself.
  turbopack: { root: __dirname },
};

export default config;
