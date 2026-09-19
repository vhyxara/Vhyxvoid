'use client'

import type { ReactNode } from 'react'

import { RootProvider } from 'fumadocs-ui/provider/next'

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      // Dark-only: `class` keeps Fumadocs' own `dark:` variants + code-block
      // theme on, `data-theme` drives the VhyxUI tokens.
      theme={{ forcedTheme: 'dark' }}
      search={{ options: { api: '/docs/api/search' } }}
    >
      {children}
    </RootProvider>
  )
}
