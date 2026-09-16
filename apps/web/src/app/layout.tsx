// MUI Imports
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'

// Third-party Imports
import 'react-perfect-scrollbar/dist/css/styles.css'

// Type Imports
// import type { ChildrenType } from '@core/types'

// Style Imports
import '@/app/globals.css'

// VhyxUI token variables (colors/spacing/typography) — safe to load globally,
// this file defines CSS custom properties only, no element-selector resets.
// Do NOT import '@vhyxui/tokens/reset.css' here: MUI's CssBaseline is still
// active on most routes (see Providers.tsx), and both stylesheets set a
// same-specificity `body { background-color }` rule — whichever loads later
// wins, silently overriding MUI's theme background. reset.css is only safe
// on a route once it has no CssBaseline mounted; see (public-pages)/layout.tsx
// for the one route group where that's currently true.
// See decision.md, 2026-09-10, "CSS-reset conflict resolved" for the finding
// this works around.
import '@vhyxui/tokens/index.css'

// VhyxVoid's brand-color override, scoped under [data-brand="vhyxvoid"] —
// lives in this repo (not VhyxUI's) since it's consumer-specific branding,
// not a VhyxUI bug fix. Must load AFTER '@vhyxui/tokens/index.css' above so
// its values win over VhyxUI's own defaults for the same custom properties
// (same-specificity attribute selectors — load order decides the winner).
// See decision.md, 2026-09-10, "VhyxUI brand override file relocated from
// VhyxUI's repo to VhyxVoid's".
import './vhyxui-brand-override.css'

// VhyxUI's component CSS (Button, Dialog, Card, etc.) — pure CSS Modules
// output, purely class-scoped selectors, zero body/html/* rules (confirmed
// by inspecting dist/style.css directly), so unlike reset.css this has no
// coexistence risk with MUI and is safe to load globally right away.
import '@vhyxui/react/style.css'

// Generated Icon CSS Imports
import '@assets/iconify-icons/generated-icons.css'

// import { setRequestLocale } from 'next-intl/server'

// VhyxUI's toast() is a global imperative API backed by a store that
// ToastProvider subscribes to and renders — with no provider mounted
// anywhere, toast() silently no-ops (confirmed empirically: no console
// warning, no DOM node, during Step 2's login-page functional test).
// Mounted here (not per-route) since toast is a cross-cutting concern, via
// a thin 'use client' wrapper (VhyxUIToastRegion) rather than rendering
// ToastProvider directly from this Server Component layout — see that
// file's comment and decision.md, 2026-09-10, for why. Also: deliberately
// using ToastProvider directly rather than the full VhyxUIProvider — see
// decision.md, "ToastProvider mounted directly, not via VhyxUIProvider".
import VhyxUIToastRegion from '@/libs/components/VhyxUIToastRegion'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

export const metadata = {
  title: 'VhyxVoid — Secure Localhost Tunnels',
  description:
    'VhyxVoid is a developer-focused tunneling platform for securely exposing localhost to the internet. Create fast, reliable tunnels in seconds and share local apps through the void.'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const systemMode = await getSystemMode()

  return (
    <html
      id='__next'
      dir='ltr'
      data-brand='vhyxvoid'
      data-theme={systemMode}
      suppressHydrationWarning
    >
      <body className='flex is-full min-bs-full flex-auto flex-col'>
        <InitColorSchemeScript attribute='data' defaultMode={systemMode} />
        <VhyxUIToastRegion>{children}</VhyxUIToastRegion>
      </body>
    </html>
  )
}
