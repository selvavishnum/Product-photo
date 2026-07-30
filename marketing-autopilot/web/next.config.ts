import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:8080';

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
