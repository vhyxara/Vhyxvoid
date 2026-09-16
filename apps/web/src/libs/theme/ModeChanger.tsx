// React Imports
import { useEffect } from 'react'

// MUI Imports
import { useColorScheme } from '@mui/material/styles'

// Third-party Imports
import { useMedia } from 'react-use'

// Type Imports
import type { SystemMode } from '@core/types'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

const ModeChanger = ({ systemMode }: { systemMode: SystemMode }) => {
  // Hooks
  const { setMode } = useColorScheme()
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  useEffect(() => {
    if (settings.mode) {
      const resolvedMode = settings.mode === 'system' ? (isDark ? 'dark' : 'light') : settings.mode

      setMode(resolvedMode)

      // Keep VhyxUI's data-theme in sync with MUI's own data-mui-color-scheme.
      // The two libraries use different attribute names for the same concept
      // (see decision.md, 2026-09-10, "data-brand/data-theme wiring") — this
      // is the one place mode changes at runtime, so it's the one place that
      // needs to write both.
      document.documentElement.setAttribute('data-theme', resolvedMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode])

  return null
}

export default ModeChanger
