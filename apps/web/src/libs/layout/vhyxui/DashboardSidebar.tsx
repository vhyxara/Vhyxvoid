'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

import { Drawer } from '@vhyxui/react'

import useVerticalNav from '@menu/hooks/useVerticalNav'
import useMediaQuery from '@menu/hooks/useMediaQuery'
import { defaultBreakpoints } from '@menu/defaultConfigs'
import { useSettings } from '@core/hooks/useSettings'
import Logo from '@/libs/layout/shared/Logo'

import { DashboardSidebarNav } from './DashboardSidebarNav'
import styles from './DashboardSidebar.module.css'

const COLLAPSED_WIDTH = 71
const EXPANDED_WIDTH = 260

// Reuses the EXISTING VerticalNavProvider context (mounted in Providers.tsx,
// unchanged) and the existing settings/cookie system for persistence — only
// the rendering/markup layer is new. The breakpoint-sync effect below
// replicates what the old (now-unused-here) @menu VerticalNav.tsx component
// used to do internally; see decision.md, 2026-09-10, "DashboardSidebar
// breakpoint sync replicated from @menu/VerticalNav.tsx" for why that
// couldn't just be reused as-is.
export function DashboardSidebar() {
  const {
    isCollapsed,
    isHovered,
    isToggled,
    updateVerticalNavState,
    collapseVerticalNav,
    hoverVerticalNav,
    toggleVerticalNav
  } = useVerticalNav()

  const { settings, updateSettings } = useSettings()
  const collapsedRef = useRef(false)

  // 'lg' breakpoint (1200px) — same value the rest of this app's responsive
  // nav logic already uses (@menu/defaultConfigs), kept consistent rather
  // than picking a new one.
  const breakpointReached = useMediaQuery(defaultBreakpoints.lg)

  useEffect(() => {
    updateVerticalNavState({ isBreakpointReached: breakpointReached })

    if (!breakpointReached) {
      updateVerticalNavState({ isToggled: false })
      if (collapsedRef.current) updateVerticalNavState({ isCollapsed: true })
    } else {
      if (isCollapsed && !collapsedRef.current) collapsedRef.current = true
      if (isCollapsed) updateVerticalNavState({ isCollapsed: false })
      if (isHovered) updateVerticalNavState({ isHovered: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpointReached, updateVerticalNavState])

  // Persisted layout setting -> live collapse state (matches the original
  // Navigation.tsx's effect exactly).
  useEffect(() => {
    collapseVerticalNav(settings.layout === 'collapsed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layout])

  const showLabels = !isCollapsed || Boolean(isHovered)
  const width = isCollapsed && !isHovered ? COLLAPSED_WIDTH : EXPANDED_WIDTH

  const handleNavigate = () => {
    if (isToggled) toggleVerticalNav(false)
  }

  const sidebarContent = (
    <>
      <div className={styles.header}>
        <Link href='/' className={styles.logoLink}>
          <Logo />
        </Link>
        {showLabels && (
          <button
            type='button'
            className={styles.collapseToggle}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => updateSettings({ layout: isCollapsed ? 'vertical' : 'collapsed' })}
          >
            <i className={isCollapsed ? 'tabler-circle-dot' : 'tabler-circle'} />
          </button>
        )}
      </div>
      <DashboardSidebarNav showLabels={showLabels} onNavigate={handleNavigate} />
    </>
  )

  if (breakpointReached) {
    return (
      <Drawer open={Boolean(isToggled)} onOpenChange={open => toggleVerticalNav(open)} side='left' size='sm'>
        <Drawer.Portal>
          <Drawer.Overlay />
          <Drawer.Content className={styles.mobileDrawerContent}>
            <Drawer.Title className={styles.srOnly}>Navigation</Drawer.Title>
            {sidebarContent}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    )
  }

  return (
    <aside
      className={styles.desktopSidebar}
      style={{ width }}
      onMouseEnter={() => isCollapsed && hoverVerticalNav(true)}
      onMouseLeave={() => isCollapsed && hoverVerticalNav(false)}
    >
      {sidebarContent}
    </aside>
  )
}
