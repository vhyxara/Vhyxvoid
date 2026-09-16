'use client'

import { Popover } from '@vhyxui/react'

import type { Mode } from '@core/types'
import { useSettings } from '@core/hooks/useSettings'

import styles from './ModeDropdown.module.css'

// Ported 1:1 from libs/layout/shared/ModeDropdown.tsx (real, live — confirmed
// wired to the actual settings/cookie system, not dead). Popover replaces
// MUI's Popper+Fade+Paper+ClickAwayListener+MenuList/MenuItem combination;
// Popover's own click-outside/Escape handling covers what ClickAwayListener
// did. Dropped the Tooltip-on-hover (VhyxUI has no equivalent primitive and
// it wasn't essential — the icon change already communicates the state).
export function ModeDropdown() {
  const { settings, updateSettings } = useSettings()

  const getModeIcon = () => {
    if (settings.mode === 'system') return 'tabler-device-laptop'
    if (settings.mode === 'dark') return 'tabler-moon-stars'

    return 'tabler-sun'
  }

  const handleModeSwitch = (mode: Mode) => {
    if (settings.mode !== mode) updateSettings({ mode })
  }

  return (
    <Popover>
      <Popover.Trigger className={styles.trigger} aria-label={`${settings.mode} mode`}>
        <i className={getModeIcon()} />
      </Popover.Trigger>
      <Popover.Content side='bottom' align='start' className={styles.menu}>
        {(['light', 'dark', 'system'] as const).map(mode => (
          <Popover.Close
            key={mode}
            className={styles.item}
            data-selected={settings.mode === mode}
            onClick={() => handleModeSwitch(mode)}
          >
            <i className={mode === 'light' ? 'tabler-sun' : mode === 'dark' ? 'tabler-moon-stars' : 'tabler-device-laptop'} />
            <span style={{ textTransform: 'capitalize' }}>{mode}</span>
          </Popover.Close>
        ))}
      </Popover.Content>
    </Popover>
  )
}
