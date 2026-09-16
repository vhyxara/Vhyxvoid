// Replaces @layouts/LayoutWrapper + @layouts/VerticalLayout +
// @layouts/components/vertical/LayoutContent. AuthGuard/ScrollToTop/
// FeedbackButton are NOT included here — they stay wired in
// (dashboard)/layout.tsx exactly where they were, since none of those are
// nav-chrome and none needed touching for this step.

import type { ReactNode } from 'react'

import { DashboardSidebar } from './DashboardSidebar'
import { DashboardTopbar } from './DashboardTopbar'
import { DashboardFooter } from './DashboardFooter'
import styles from './DashboardShell.module.css'

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <DashboardSidebar />
      <div className={styles.contentColumn}>
        <DashboardTopbar />
        <main className={styles.content}>{children}</main>
        <DashboardFooter />
      </div>
    </div>
  )
}
