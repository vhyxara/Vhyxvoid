'use client'

// React Imports
import { useEffect } from 'react'

// Third-party Imports
import { useMedia } from 'react-use'

// Type Imports
import type { SystemMode } from '@core/types'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

const ModeChanger = ({ systemMode }: { systemMode: SystemMode }) => {
  // Hooks
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  useEffect(() => {
    if (settings.mode) {
      const resolvedMode = settings.mode === 'system' ? (isDark ? 'dark' : 'light') : settings.mode

      // Real bug fixed here (found 2026-09-16, Phase 4 part 2b): this effect
      // previously only depended on [settings.mode], so a live OS-preference
      // change while settings.mode === 'system' never updated data-theme at
      // all — only MUI's now-removed setMode() call ever caught that case,
      // for MUI components only. Now also depends on `isDark`.
      document.documentElement.setAttribute('data-theme', resolvedMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, isDark])

  return null
}

export default ModeChanger
