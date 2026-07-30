import type { NextConfig } from 'next';

/**
 * The API's origin, normalised to an absolute URL.
 *
 * Two deploy targets set this differently and neither can be trusted to
 * include a scheme: Vercel takes whatever is pasted into the dashboard, and
 * Render's `fromService` yields a bare `host:port`. A rewrite destination
 * must be absolute, and a missing scheme produces a rewrite that silently
 * never matches -- so the wizard would fail in production only.
 */
function resolveApiOrigin(): string {
  const raw = process.env.API_ORIGIN?.trim();
  if (!raw) return 'http://localhost:8080';
  if (/^https?:\/\//.test(raw)) return raw;
  return `https://${raw}`;
}

const API_ORIGIN = resolveApiOrigin();

const config: NextConfig = {
  // The repo has several package.json files (backend, web), so Next's
  // workspace-root inference picks the wrong directory and then cannot
  // resolve itself. Pin it.
  turbopack: { root: __dirname },
  // The Express API stays a separate process. Proxying it under the same
  // origin avoids CORS entirely and means the browser never needs to know the
  // backend's address -- which also keeps it swappable per environment.
  //
  // On Vercel these are handled by the routing layer, not a serverless
  // function, so proxying costs a hop but no invocation.
  async rewrites() {
    return [
      // Wakes the API. Render's free plan stops a service after 15 minutes
      // idle and a cold start is ~50s, which lands squarely on the user when
      // they press "Make my ad". The wizard hits this on mount so the API
      // boots while the form is being filled in.
      //
      // Needs its own entry because /health sits outside /api on the Express
      // side, so the catch-all below cannot reach it.
      { source: '/api/warmup', destination: `${API_ORIGIN}/health` },
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
    ];
  },
};

export default config;
