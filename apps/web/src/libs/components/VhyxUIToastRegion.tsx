'use client'

// Thin client boundary around VhyxUI's ToastProvider. Required because
// Turbopack doesn't reliably see ToastProvider's own 'use client' directive
// through the cross-repo `link:` symlink to VhyxUI's bundled dist output
// (confirmed via a real build error referencing VhyxUI/packages/react/dist/
// Toast-*.js during Step 2's functional test) — same class of friction as
// Button needing an explicit 'use client' on its consuming page in Step 0/1.
// Mirrors the existing pattern this app already uses for CustomThemeProvider
// (an async Server Component — layout.tsx — rendering a 'use client' child).

import { ToastProvider } from '@vhyxui/react'

export default function VhyxUIToastRegion({ children }: { children: React.ReactNode }) {
  // VhyxUI resolves its own separate @types/react (cross-repo — same class
  // of friction as the Form/react-hook-form typing gap) — cast to bypass a
  // phantom ReactNode mismatch, not an actual runtime incompatibility.
  return <ToastProvider>{children as any}</ToastProvider>
}
