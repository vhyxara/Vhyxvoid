'use client'

// Client boundary around VhyxUIProvider, plus the admin's light/dark choice
// (kept in localStorage; "system" follows the OS).
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

import { VhyxUIProvider } from '@vhyxui/react'

type Theme = 'light' | 'dark' | 'system'

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'system', setTheme: () => {} })

export const useAdminTheme = () => useContext(ThemeContext)

export default function VhyxUIRoot({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin-theme') as Theme | null

      if (saved === 'light' || saved === 'dark' || saved === 'system') setThemeState(saved)
    } catch {
      // storage unavailable: keep "system"
    }
  }, [])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem('admin-theme', t)
    } catch {
      // ignore
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <VhyxUIProvider theme={theme}>{children as any}</VhyxUIProvider>
    </ThemeContext.Provider>
  )
}
