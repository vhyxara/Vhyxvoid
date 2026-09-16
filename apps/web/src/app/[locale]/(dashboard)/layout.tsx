// Type Imports
import type { ChildrenType } from '@core/types'

// Layout Imports
import LayoutWrapper from '@layouts/LayoutWrapper'

// Component Imports
import Providers from '@/libs/components/Providers'
import { DashboardShell } from '@/libs/layout/vhyxui/DashboardShell'

import ScrollToTop from '@core/components/scroll-to-top'
import { ScrollToTopButton } from '@core/components/scroll-to-top/ScrollToTopButton'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

import { AuthGuard } from '@/api/domain/identity/guard/AuthGuard'
import { FeedbackButton } from '@/views/feedback/FeedbackButton'

// Step 3 of the VhyxUI migration replaced VerticalLayout/Navigation/Navbar/
// VerticalFooter (the vendored @menu + @layouts Vuexy nav system) with
// DashboardShell (new, VhyxUI-based). LayoutWrapper is KEPT — it turned out
// not to be nav-chrome at all: it's a thin div plus a call to
// useLayoutInit(systemMode), which maintains a colorPref SSR cookie (an
// SSR-only fallback consulted on the *next* page load) via a live OS-
// preference subscription. This is a genuinely different concern from
// ModeChanger.tsx's data-theme write (the *live* client DOM attribute for
// the *current* page) — not because only one of them reacts to live
// OS-preference changes (both do, as of Phase 4 part 3's fix), but because
// they write to two different places for two different consumers (a cookie
// read at SSR time vs. a DOM attribute read by CSS immediately). Dropping
// LayoutWrapper would silently break the next-page-load SSR fallback.
// Providers is otherwise unchanged. AuthGuard's loading spinner, this
// file's own ScrollToTop button, and NotificationBell were migrated off
// MUI in Phase 1/Phase 3 part 1; FeedbackButton and ScrollToTop's own
// Zoom/useScrollTrigger wrapper (a MUI holdout the original audit missed)
// were migrated in Phase 3 part 2 — see decision.md. ThemeProvider/
// CssBaseline (formerly inside Providers) and the entire @core/theme/
// libs/theme construction tree that fed them were removed entirely in
// Phase 4 part 3 — Providers now only wires SettingsProvider/ModeChanger/
// VerticalNavProvider, no MUI dependency anywhere in this tree. See
// decision.md, 2026-09-10, "Step 3 dashboard shell rebuilt on VhyxUI", and
// decision.md, 2026-09-16, "Phase 4 part 3"/"Phase 4 part 4".
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
        <ScrollToTopButton />
      </ScrollToTop>
    </Providers>
  )
}

export default Layout
