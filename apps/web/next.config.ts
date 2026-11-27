import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // A self-contained server with only the files it needs, for the Docker image.
  output: 'standalone',
  // Trace files from the monorepo root, so workspace packages are included.
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
};

export default nextConfig;
