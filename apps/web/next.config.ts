import type { NextConfig } from 'next';

const config: NextConfig = {
  devIndicators: false,
  // No `X-Powered-By`: what runs the site is nobody's business.
  poweredByHeader: false,
  // The end-to-end run builds into its own folder, so it can run beside a dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default config;
