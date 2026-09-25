'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Badge } from '@vhyxui/react'

import { Skeleton } from '@/components/vhyxui-shims'
import { useMyAccounts } from '@/api/application/hooks/useMe'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import type { MyAccount } from '@/api/domain/identity/types/org.types'

import styles from './DashboardSidebarNav.module.css'

// Ported 1:1 from the original apps/web/src/libs/layout/vertical/VerticalMenu.tsx
// (Vuexy @menu-based nav) — same routes, same role gating, same skeleton/empty
// states. Only the presentation layer changed (VhyxUI tokens + plain markup
// instead of the vendored @menu Menu/MenuItem/SubMenu/MenuSection components).

function NavLink({
  href,
  icon,
  children,
  onNavigate
}: {
  href: string
  icon: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === href

  return (
    <Link href={href} onClick={onNavigate} className={styles.link} data-active={isActive}>
      <i className={icon} />
      <span className={styles.linkLabel}>{children}</span>
    </Link>
  )
}

// The account a user gets automatically at signup (`PERSONAL`) is a single-owner
// workspace: it can hold API keys and tunnels like any account and can be
// upgraded (Billing), but it never has members (the API refuses invites) and
// its name can't be changed, so Members and Settings are not offered. See
// decision.md, 2026-09-21, "Personal accounts get a sidebar entry", and
// shared/decision.md, 2026-09-25 (Billing added).
function RoleBadge({ roleLevel }: { roleLevel: RoleLevel }) {
  if (roleLevel === RoleLevel.OWNER) {
    return (
      <Badge variant='danger' size='sm'>
        Owner
      </Badge>
    )
  }

  if (roleLevel === RoleLevel.ADMIN) {
    return (
      <Badge variant='warning' size='sm'>
        Admin
      </Badge>
    )
  }

  return null
}

function OrgSubNav({
  account,
  showLabels,
  onNavigate
}: {
  account: MyAccount
  showLabels: boolean
  onNavigate?: () => void
}) {
  const [open, setOpen] = useState(true)
  const isPersonal = account.accountType === 'PERSONAL'
  const isAdmin = account.roleLevel >= RoleLevel.ADMIN
  const isOwner = account.roleLevel === RoleLevel.OWNER
  const orgName = account.accountName ?? (isPersonal ? 'Personal workspace' : 'Unnamed organization')
  const id = account.accountId

  // Sub-items only ever render when labels are visible — there's no flyout-
  // on-hover-while-collapsed interaction (matches the original: Navigation.tsx
  // never enables isPopoutWhenCollapsed, so collapsed+unhovered never shows
  // nested items either).
  const expanded = open && showLabels

  return (
    <div>
      <button
        type='button'
        className={styles.subNavToggle}
        onClick={() => setOpen(o => !o)}
        aria-expanded={expanded}
      >
        <i className={isPersonal ? 'tabler-user' : 'tabler-building'} />
        <span className={styles.orgName}>{orgName}</span>
        {!isPersonal && <RoleBadge roleLevel={account.roleLevel} />}
        <i className={`tabler-chevron-right ${styles.chevron}`} data-open={expanded} />
      </button>

      {expanded && (
        <div className={styles.subItems}>
          {!isPersonal && (
            <NavLink href={`/organizations/${id}/members`} icon='tabler-users' onNavigate={onNavigate}>
              Members
            </NavLink>
          )}
          <NavLink href={`/organizations/${id}/api-keys`} icon='tabler-key' onNavigate={onNavigate}>
            API Keys
          </NavLink>
          <NavLink href={`/organizations/${id}/tunnels`} icon='tabler-plug' onNavigate={onNavigate}>
            Tunnels
          </NavLink>
          {isOwner && (
            <NavLink href={`/organizations/${id}/billing`} icon='tabler-credit-card' onNavigate={onNavigate}>
              Billing
            </NavLink>
          )}
          {isAdmin && !isPersonal && (
            <NavLink href={`/organizations/${id}/settings`} icon='tabler-settings' onNavigate={onNavigate}>
              Settings
            </NavLink>
          )}
        </div>
      )}
    </div>
  )
}

function NavSkeleton() {
  return (
    <div className={styles.skeletonGroup}>
      {[1, 2, 3].map(i => (
        <Skeleton key={i} variant='rectangular' height={36} />
      ))}
    </div>
  )
}

export interface DashboardSidebarNavProps {
  /** False when the desktop sidebar is collapsed and not hovered — hides text/labels. */
  showLabels: boolean
  /** Called after navigating — used to auto-close the mobile drawer. */
  onNavigate?: () => void
}

export function DashboardSidebarNav({ showLabels, onNavigate }: DashboardSidebarNavProps) {
  const { data: accounts, isLoading } = useMyAccounts()
  const personalAccounts = accounts?.filter(a => a.accountType === 'PERSONAL') ?? []
  const orgAccounts = accounts?.filter(a => a.accountType === 'ORGANIZATION') ?? []

  return (
    <nav className={styles.nav} data-show-labels={showLabels}>
      <NavLink href='/dashboard' icon='tabler-smart-home' onNavigate={onNavigate}>
        Dashboard
      </NavLink>

      {personalAccounts.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Personal workspace</div>
          {personalAccounts.map(account => (
            <OrgSubNav key={account.accountId} account={account} showLabels={showLabels} onNavigate={onNavigate} />
          ))}
        </>
      )}

      <div className={styles.sectionLabel}>Organizations</div>
      {isLoading ? (
        <NavSkeleton />
      ) : orgAccounts.length === 0 ? (
        <NavLink href='/dashboard' icon='tabler-plus' onNavigate={onNavigate}>
          Create organization
        </NavLink>
      ) : (
        orgAccounts.map(account => (
          <OrgSubNav key={account.accountId} account={account} showLabels={showLabels} onNavigate={onNavigate} />
        ))
      )}

      <div className={styles.sectionLabel}>Account</div>
      <NavLink href='/profile' icon='tabler-user' onNavigate={onNavigate}>
        My profile
      </NavLink>
    </nav>
  )
}
