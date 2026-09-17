import path from 'node:path'

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    // Same reason as apps/web's next.config.ts: @vhyxui/react, @vhyxui/tokens,
    // and @vhyx/api-kit are all consumed via pnpm's `link:` protocol pointing
    // at sibling repos (VhyxUI, vhyx-api-kit) outside this monorepo entirely.
    // Turbopack only resolves a symlinked module if its target falls inside
    // the configured root, so this is widened one level past the monorepo
    // root to the common parent of Black-Server/VhyxUI/vhyx-api-kit.
    root: path.join(__dirname, '..', '..', '..')
  }
}

export default nextConfig
