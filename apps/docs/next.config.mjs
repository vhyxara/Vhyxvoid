import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

// basePath '/docs': apps/web proxies `/docs/*` to this app (see
// apps/web/next.config.ts), so every URL this app emits — pages, /_next
// assets, the search API — must already live under /docs on the shared origin.
// No `turbopack.root` widening (unlike apps/web/apps/admin): nothing here is
// consumed via a sibling-repo `link:`; the VhyxUI token CSS is copied in.
/** @type {import('next').NextConfig} */
const config = {
  basePath: '/docs',
  reactStrictMode: true
}

export default withMDX(config)
