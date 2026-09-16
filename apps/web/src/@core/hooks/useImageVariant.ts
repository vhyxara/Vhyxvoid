// React Imports
import { useMemo } from 'react'

// Type imports
import type { Mode } from '@core/types'

// Hook Imports
import { useSettings } from './useSettings'
import { useResolvedMode } from './useResolvedMode'

export const useImageVariant = (
  mode: Mode,
  imgLight: string,
  imgDark: string,
  imgLightBordered?: string,
  imgDarkBordered?: string
): string => {
  // Hooks
  const { settings } = useSettings()
  const resolvedMode = useResolvedMode(mode === 'dark' ? 'dark' : 'light')

  return useMemo(() => {
    const isBordered = settings?.skin === 'bordered'
    const isDarkMode = resolvedMode === 'dark'

    if (isBordered && imgLightBordered && imgDarkBordered) {
      return isDarkMode ? imgDarkBordered : imgLightBordered
    }

    return isDarkMode ? imgDark : imgLight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedMode])
}
