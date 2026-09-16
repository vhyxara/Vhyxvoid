// MUI Imports
import Button from '@mui/material/Button'

// Type Imports
import type { ChildrenType } from '@core/types'

// Layout Imports
import LayoutWrapper from '@layouts/LayoutWrapper'

// Component Imports
import Providers from '@/libs/components/Providers'
import { DashboardShell } from '@/libs/layout/vhyxui/DashboardShell'

import ScrollToTop from '@core/components/scroll-to-top'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

import { AuthGuard } from '@/api/domain/identity/guard/AuthGuard'
import { FeedbackButton } from '@/views/feedback/FeedbackButton'

// Step 3 of the VhyxUI migration replaced VerticalLayout/Navigation/Navbar/
// VerticalFooter (the vendored @menu + @layouts Vuexy nav system) with
// DashboardShell (new, VhyxUI-based). LayoutWrapper is KEPT — it turned out
// not to be nav-chrome at all: it's a thin, MUI-free div plus a call to
// useLayoutInit(systemMode), which live-syncs MUI's color mode to the OS
// preference while settings.mode==='system' and maintains a colorPref SSR
// cookie — genuinely different from ModeChanger.tsx (that one only reacts to
// explicit settings.mode changes, not live OS-preference changes). Dropping
// LayoutWrapper would have silently broken that. Providers, AuthGuard,
// ScrollToTop, and FeedbackButton are otherwise unchanged. CssBaseline/
// ThemeProvider (inside Providers) stays active: even though the new shell
// itself has zero MUI dependency, the page CONTENT (dashboard/organizations
// pages, not yet migrated), AuthGuard's loading spinner, and
// NotificationBell/FeedbackButton (deliberately left MUI-internal, see
// decision.md) all still need it. See decision.md, 2026-09-10, "Step 3
// dashboard shell rebuilt on VhyxUI".
const Layout = async (props: ChildrenType) => {
  const { children } = props

  // Vars
  const direction = 'ltr'
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <LayoutWrapper
        systemMode={systemMode}
        verticalLayout={
          <DashboardShell>
            <AuthGuard>
              {children}
              <FeedbackButton />
            </AuthGuard>
          </DashboardShell>
        }
      />
      <ScrollToTop className='mui-fixed'>
        <Button variant='contained' className='is-10 bs-10 rounded-full p-0 min-is-0 flex items-center justify-center'>
          <i className='tabler-arrow-up' />
        </Button>
      </ScrollToTop>
    </Providers>
  )
}

export default Layout
