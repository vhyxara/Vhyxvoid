'use client'

// Thin client boundary around VhyxUI's VhyxUIProvider. Required for the
// same reason apps/web's VhyxUIToastRegion.tsx documents: Turbopack doesn't
// reliably see a VhyxUI component's own 'use client' directive through the
// cross-repo `link:` symlink to VhyxUI's bundled dist output when it's
// imported directly into a Server Component (RootLayout, here).
//
// Uses the full VhyxUIProvider (skip-link + SealProvider + ToastProvider),
// not the narrower ToastProvider-only wrapper apps/web deliberately chose
// (internal-tools/user-frontend/decision.md, 2026-09-10, "ToastProvider
// mounted directly, not via VhyxUIProvider") — that choice was scoped to
// apps/web's MUI-migration-era hesitation about pulling in "unverified"
// SealProvider behavior for no benefit at the time. apps/admin has no such
// history and no MUI to coexist with, so there's no reason to withhold the
// canonical top-level provider from a fresh app.
import type { ReactNode } from 'react'

import { VhyxUIProvider } from '@vhyxui/react'

export default function VhyxUIRoot({ children }: { children: ReactNode }) {
  // VhyxUI resolves its own separate @types/react across the `link:`
  // boundary — same phantom ReactNode type mismatch apps/web casts around
  // in VhyxUIToastRegion.tsx, not an actual runtime incompatibility.
  return <VhyxUIProvider>{children as any}</VhyxUIProvider>
}
