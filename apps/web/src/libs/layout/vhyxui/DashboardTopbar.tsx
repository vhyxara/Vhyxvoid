// Composes the new dashboard topbar. NavToggle is reused completely
// unchanged — it was already framework-agnostic (plain useVerticalNav() +
// a bare <i> icon, zero MUI) despite living in the old vertical/ directory,
// so there was nothing to migrate there. NotificationBell was migrated to
// VhyxUI in Phase 3 (2026-09-16, see decision.md) — Popover replaces its
// Popper+Fade+Paper+ClickAwayListener combination, same as ModeDropdown/
// UserDropdown. FeedbackButton remains MUI-internal, its own follow-up
// session (Phase 3 part 2).

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
