import type { NextConfig } from 'next';

/**
 * Render's `fromService` gives a bare `host:port` with no scheme, but a
 * rewrite destination must be an absolute URL. Normalise rather than assume:
 * a missing scheme silently produces a rewrite that never matches, so the
 * wizard would fail only in production.
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
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default config;
