import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The monorepo root (pnpm workspace): every dependency, including the
  // in-repo @vhyxvoid/api-kit, resolves inside it.
  turbopack: { root: path.join(__dirname, '..', '..') },
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false,
  // Media library images are stored as site paths (/media/<id>/<name>) and
  // served by the website; the console shows them from there too, so a
  // picture in the rich text editor looks the same here as on the site.
  async rewrites() {
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

    return [{ source: '/media/:path*', destination: `${site}/media/:path*` }]
  }
}

export default nextConfig
