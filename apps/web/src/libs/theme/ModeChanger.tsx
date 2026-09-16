'use client'

// React Imports
import { useEffect } from 'react'

// Type Imports
import type { SystemMode } from '@core/types'

// Hook Imports
import { useResolvedMode } from '@core/hooks/useResolvedMode'

const ModeChanger = ({ systemMode }: { systemMode: SystemMode }) => {
  // Hooks
  // useResolvedMode() already covers both explicit settings.mode changes and
  // live OS-preference changes (including the settings.mode === 'system'
  // live-sync fix from Phase 4 part 3) via its own useMedia subscription —
  // reuse it instead of re-deriving the same resolution here with a second,
  // redundant matchMedia listener. See decision.md, 2026-09-16, "Phase 4
  // part 4".
  const resolvedMode = useResolvedMode(systemMode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedMode)
  }, [resolvedMode])

  return null
}

export default ModeChanger
