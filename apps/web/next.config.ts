import path from 'node:path'

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

const nextConfig: NextConfig = {
  // basePath: process.env.BASEPATH
  turbopack: {
    // Pin the workspace root explicitly rather than letting Next.js infer it
    // from the nearest lockfile (which can pick up an unrelated one elsewhere
    // on disk). This is widened one level past the monorepo root itself, to
    // the common parent of Black-Server and the separate VhyxUI repo, because
    // @vhyxui/react and @vhyxui/tokens are consumed via pnpm's `link:` protocol
    // pointing at VhyxUI's package directories — Turbopack only resolves
    // modules reached through a symlink if the symlink's target falls inside
    // this configured root.
    root: path.join(__dirname, '..', '..', '..')
  },
  async rewrites() {
    return []
  }
}

export default withNextIntl(nextConfig)
