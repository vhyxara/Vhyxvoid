// Composes the new dashboard topbar. NavToggle is reused completely
// unchanged — it was already framework-agnostic (plain useVerticalNav() +
// a bare <i> icon, zero MUI) despite living in the old vertical/ directory,
// so there was nothing to migrate there. NotificationBell is deliberately
// left as fully MUI-internal — see decision.md, 2026-09-10, "NotificationBell
// and FeedbackButton left as MUI-internal, not migrated in Step 3" — it's a
// real, substantial data-driven feature (12 notification-type mappings, mark-
// read mutations, etc.), not nav chrome, and migrating its internals is out
// of this step's scope.

import NavToggle from '@/libs/layout/vertical/NavToggle'
import { NotificationBell } from '@/views/notification/NotificationBell'

import { ModeDropdown } from './ModeDropdown'
import { UserDropdown } from './UserDropdown'
import styles from './DashboardTopbar.module.css'

export function DashboardTopbar() {
  return (
    <header className={styles.header}>
      <div className={styles.side}>
        <NavToggle />
        <ModeDropdown />
      </div>

      <div className={styles.side}>
        <NotificationBell />
        <UserDropdown />
      </div>
    </header>
  )
}
