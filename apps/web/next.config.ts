import path from 'node:path'

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin()

// /docs is served by apps/docs (a separate Next app whose basePath is '/docs'),
// proxied through this app so both share one origin. Where that app is deployed
// is a deploy-time fact, not derivable from this repo (nginx.conf only fronts
// api./hub.), so it comes from DOCS_ORIGIN. In dev it defaults to apps/docs's
// own port. With no origin (production, unset) no rewrite is registered and
// /docs falls through to the "Coming soon" placeholder page — deliberately
// visible, not a broken proxy. See internal-tools/docs/decision.md.
const docsOrigin = (
  process.env.DOCS_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4002')
).replace(/\/$/, '')

if (!docsOrigin && process.env.NODE_ENV === 'production') {
  console.warn('[apps/web] DOCS_ORIGIN is not set: /docs will show the placeholder page instead of apps/docs.')
}

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
  // Read by src/proxy.ts to keep next-intl's locale handling off /docs.
  env: { DOCS_ORIGIN_RESOLVED: docsOrigin },
  async rewrites() {
    if (!docsOrigin) return []

    return {
      // beforeFiles: must win over the placeholder page at [locale]/docs.
      beforeFiles: [
        { source: '/docs', destination: `${docsOrigin}/docs` },
        { source: '/docs/:path*', destination: `${docsOrigin}/docs/:path*` }
      ],
      afterFiles: [],
      fallback: []
    }
  }
}

export default withNextIntl(nextConfig)
