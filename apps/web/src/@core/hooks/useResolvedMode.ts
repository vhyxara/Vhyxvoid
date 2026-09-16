import { useMedia } from 'react-use'

import type { SystemMode } from '@core/types'
import { useSettings } from './useSettings'

// Framework-independent replacement for MUI's useColorScheme() — reactive
// to both explicit settings.mode changes AND live OS-preference changes
// (matching what useColorScheme()'s own systemMode value already gave
// callers). Wraps react-use's useMedia rather than reimplementing
// window.matchMedia directly the way useBreakpointDown had to — no
// existing hook covered useBreakpointDown's arbitrary-pixel-threshold
// case, but useMedia already covers this exact query and is the
// already-established pattern for it (useLayoutInit.ts, ModeChanger.tsx,
// and libs/theme/index.tsx's CustomThemeProvider all already call it
// identically). See decision.md, 2026-09-16, "Phase 4 part 2b".
export function useResolvedMode(fallback: SystemMode = 'light'): SystemMode {
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', fallback === 'dark')

  if (!settings.mode || settings.mode === 'system') return isDark ? 'dark' : 'light'

  return settings.mode
}
