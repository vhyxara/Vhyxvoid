import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The monorepo root (pnpm workspace): every dependency, including the
  // in-repo @vhyxvoid/api-kit, resolves inside it.
  turbopack: { root: path.join(__dirname, '..', '..') },
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false
}

export default nextConfig
