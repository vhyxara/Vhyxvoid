import type { ReactNode } from 'react'

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

import ModeChanger from './ModeChanger'
import { SettingsProvider } from '@core/contexts/settingsContext'
import type { Settings } from '@core/contexts/settingsContext'

/**
 * Regression coverage for the Phase 4 part 4 refactor (decision.md,
 * 2026-09-16, "Phase 4 part 4") — ModeChanger.tsx now calls useResolvedMode()
 * instead of re-deriving the same resolution with its own independent
 * useSettings()+useMedia() call. The thing that must not regress is the
 * actual bug useResolvedMode()'s dependency-array fix was built to close
 * (decision.md, "Phase 4 part 2b"/"Phase 4 part 3"): a *live* OS
 * prefers-color-scheme change while settings.mode === 'system' must still
 * update data-theme, not just an explicit settings.mode change.
 */

// jsdom has no real matchMedia implementation -- a controllable fake lets
// tests simulate a live OS-preference change via its 'change' listener,
// which is exactly the mechanism useMedia (and therefore useResolvedMode)
// relies on.
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: { matches: boolean }) => void>()

  const mql = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type: string, cb: (event: { matches: boolean }) => void) => {
      listeners.add(cb)
    }),
    removeEventListener: vi.fn((_type: string, cb: (event: { matches: boolean }) => void) => {
      listeners.delete(cb)
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- typed to preserve the query arg in matchMediaFn.mock.calls
  const matchMediaFn = vi.fn((_query: string) => mql)

  vi.stubGlobal('matchMedia', matchMediaFn)

  const fireChange = (newMatches: boolean) => {
    matches = newMatches
    listeners.forEach(cb => cb({ matches: newMatches }))
  }

  return { matchMediaFn, fireChange }
}

function renderModeChanger(settingsCookie: Settings, systemMode: 'light' | 'dark' = 'light') {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SettingsProvider settingsCookie={settingsCookie} mode={settingsCookie.mode}>
        {children}
      </SettingsProvider>
    )
  }

  return render(
    <Wrapper>
      <ModeChanger systemMode={systemMode} />
    </Wrapper>
  )
}

describe('ModeChanger', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-theme')
  })

  it('resolves an explicit settings.mode directly, ignoring the OS preference', () => {
    stubMatchMedia(true) // OS prefers dark

    renderModeChanger({ mode: 'light' })

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it("resolves settings.mode === 'system' from the current OS preference on mount", () => {
    stubMatchMedia(true) // OS prefers dark

    renderModeChanger({ mode: 'system' })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it(
    "updates data-theme on a live OS prefers-color-scheme change while settings.mode === 'system' " +
      '(the exact bug fixed in Phase 4 part 3 -- must not regress via this refactor)',
    () => {
      const { fireChange } = stubMatchMedia(false) // OS starts light

      renderModeChanger({ mode: 'system' })
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')

      act(() => {
        fireChange(true) // live OS toggle to dark, no settings.mode change
      })

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    }
  )

  it('does not update data-theme on a live OS preference change when settings.mode is explicit', () => {
    const { fireChange } = stubMatchMedia(false)

    renderModeChanger({ mode: 'dark' })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    act(() => {
      fireChange(true) // OS toggling has no effect while mode is explicitly 'dark'
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('subscribes to prefers-color-scheme exactly once (no leftover duplicate matchMedia listener)', () => {
    const { matchMediaFn } = stubMatchMedia(false)

    renderModeChanger({ mode: 'system' })

    const darkQueryCalls = matchMediaFn.mock.calls.filter(([query]) => query === '(prefers-color-scheme: dark)')

    expect(darkQueryCalls).toHaveLength(1)
  })
})
