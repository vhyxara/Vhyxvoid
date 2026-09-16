'use client'

// React Imports
import { useEffect } from 'react'

// Hook Imports
import { useCookie, useMedia } from 'react-use'

const useLayoutInit = (colorSchemeFallback: 'light' | 'dark') => {
  // Hooks
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, updateCookieColorPref] = useCookie('colorPref')
  const isDark = useMedia('(prefers-color-scheme: dark)', colorSchemeFallback === 'dark')

  useEffect(() => {
    const appMode = isDark ? 'dark' : 'light'

    updateCookieColorPref(appMode)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // This hook does not return anything as it is only used to initialize the
  // color preference cookie on first load and on live OS-preference change.
}

export default useLayoutInit
