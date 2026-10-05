'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { AppShell, type SidebarNavGroup } from '@vhyxui/blocks'
import {
  ActivityIcon,
  BadgeCheckIcon,
  BuildingIcon,
  CreditCardIcon,
  FileTextIcon,
  GaugeIcon,
  HeartPulseIcon,
  KeyIcon,
  LogOutIcon,
  MessageSquareIcon,
  MoonIcon,
  RadioIcon,
  ClipboardListIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  UserLockIcon,
  UsersIcon
} from '@vhyxui/icons'
import { Avatar, Button, Input, Popover, Text, toast } from '@vhyxui/react'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { adminAuthService } from '@/api/infrastructure/auth.service'
import { useAdminTheme } from '@/components/VhyxUIRoot'
import { ChangePasswordDialog } from '@/views/profile/ChangePasswordDialog'

const NAV: Array<{ label: string; items: Array<{ label: string; href: string; icon: ReactNode }> }> = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <GaugeIcon /> },
      { label: 'System health', href: '/system', icon: <HeartPulseIcon /> }
    ]
  },
  {
    label: 'Customers',
    items: [
      { label: 'Accounts', href: '/accounts', icon: <BuildingIcon /> },
      { label: 'Users', href: '/users', icon: <UsersIcon /> },
      { label: 'API keys', href: '/api-keys', icon: <KeyIcon /> },
      { label: 'Tunnels', href: '/tunnels', icon: <RadioIcon /> },
      { label: 'Billing', href: '/billing', icon: <CreditCardIcon /> },
      { label: 'Feedback', href: '/feedback', icon: <MessageSquareIcon /> }
    ]
  },
  {
    label: 'Platform',
    items: [
      { label: 'Website content', href: '/content', icon: <FileTextIcon /> },
      { label: 'Settings', href: '/settings', icon: <SettingsIcon /> },
      { label: 'Logs', href: '/logs', icon: <ActivityIcon /> }
    ]
  },
  {
    label: 'Admin access',
    items: [
      { label: 'Admins', href: '/admin-users', icon: <UserLockIcon /> },
      { label: 'Roles', href: '/roles', icon: <ShieldIcon /> },
      { label: 'Abilities', href: '/abilities', icon: <BadgeCheckIcon /> },
      { label: 'Admin audit log', href: '/audit-log', icon: <ClipboardListIcon /> }
    ]
  }
]

function GlobalSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')

  // An email goes to Users, anything else to Accounts (name, slug, id).
  const go = () => {
    const term = q.trim()

    if (!term) return
    router.push(`${term.includes('@') ? '/users' : '/accounts'}?search=${encodeURIComponent(term)}`)
  }

  return (
    <form
      role='search'
      onSubmit={e => {
        e.preventDefault()
        go()
      }}
      className='flex-1 max-is-[28rem]'
    >
      <Input
        aria-label='Search customers'
        placeholder='Search accounts by name or slug, users by email…'
        value={q}
        onChange={e => setQ(e.target.value)}
        size='sm'
      />
    </form>
  )
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const admin = useAdminAuthStore(s => s.admin)
  const clearSession = useAdminAuthStore(s => s.clearSession)
  const { theme, setTheme } = useAdminTheme()
  const [pwOpen, setPwOpen] = useState(false)

  const nav: SidebarNavGroup[] = NAV.map(group => ({
    label: group.label,
    items: group.items.map(item => ({
      ...item,
      active: pathname === item.href || pathname.startsWith(`${item.href}/`)
    }))
  }))

  const signOut = async () => {
    try {
      await adminAuthService.logout()
    } catch {
      toast.warning?.('Signed out on this device; the server could not be reached.')
    } finally {
      clearSession()
      router.replace('/login')
    }
  }

  const dark = theme === 'dark'

  return (
    <>
      <AppShell
        linkAs={Link as any}
        brand={
          <Link href='/dashboard' className='flex items-center gap-2' style={{ textDecoration: 'none', color: 'inherit' }}>
            <span aria-hidden className='inline-block rounded-md' style={{ inlineSize: 22, blockSize: 22, background: 'var(--vhyx-color-accent, #6d28d9)' }} />
            <span>VhyxVoid Admin</span>
          </Link>
        }
        nav={nav}
        header={
          <div className='flex items-center gap-3 is-full'>
            <GlobalSearch />
            <div className='flex-1' />
            <Button
              variant='ghost'
              size='sm'
              iconOnly
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              icon={dark ? <SunIcon /> : <MoonIcon />}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
            />
            <Popover>
              <Popover.Trigger asChild>
                <button type='button' className='flex items-center gap-2' style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar size='sm' name={admin?.fullName || admin?.email || 'Admin'} />
                  <span className='hidden md:inline'>
                    <Text size='sm' weight='medium'>
                      {admin?.fullName || admin?.email}
                    </Text>
                  </span>
                </button>
              </Popover.Trigger>
              <Popover.Content align='end'>
                <div className='flex flex-col gap-2' style={{ minInlineSize: 220 }}>
                  <div>
                    <Text weight='medium'>{admin?.fullName}</Text>
                    <Text size='sm' tone='muted'>
                      {admin?.email}
                      {admin?.isSuperAdmin ? ' · Super admin' : ''}
                    </Text>
                  </div>
                  <Button variant='outline' size='sm' onClick={() => setPwOpen(true)}>
                    Change password
                  </Button>
                  <Button variant='ghost' size='sm' icon={<LogOutIcon />} onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              </Popover.Content>
            </Popover>
          </div>
        }
      >
        <div className='p-4 md:p-6'>{children}</div>
      </AppShell>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  )
}
