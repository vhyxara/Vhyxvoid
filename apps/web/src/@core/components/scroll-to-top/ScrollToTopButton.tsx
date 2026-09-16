'use client'

import { Button } from '@vhyxui/react'

// A dedicated client component, not an inline <Button> in the (dashboard)
// layout.tsx Server Component. Importing @vhyxui/react's Button directly
// from that file's top level broke the Turbopack SSR build ("(0,
// i.createContext) is not a function" collecting page data for /profile) —
// the layout is a genuine Server/Client boundary-crossing point (a bare
// layout.tsx with no 'use client' of its own), unlike the other files that
// import from @vhyxui/react without their own directive (RowAction.tsx,
// TablePaginationComponent.tsx), which are only ever reached from inside an
// already-client subtree. See decision.md, 2026-09-16, Phase 1.
export function ScrollToTopButton() {
  return <Button iconOnly aria-label='Scroll to top' icon={<i className='tabler-arrow-up' />} className='rounded-full' />
}
