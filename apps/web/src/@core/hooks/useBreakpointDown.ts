import { useEffect, useState } from 'react'

// Framework-independent replacement for MUI's
// useMediaQuery(theme.breakpoints.down(px)) — no VhyxUI equivalent exists
// (confirmed, see decision.md, 2026-09-16, "Phase 4 part 1"). SSR-safe:
// defaults to `false` on the server and on first client render, matching
// MUI's own useMediaQuery SSR behavior (parity, not a new limitation),
// then re-evaluates once mounted and on every subsequent viewport change.
export function useBreakpointDown(px: number): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${px}px)`)

    setMatches(mql.matches)

    const handleChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    mql.addEventListener('change', handleChange)

    return () => mql.removeEventListener('change', handleChange)
  }, [px])

  return matches
}
