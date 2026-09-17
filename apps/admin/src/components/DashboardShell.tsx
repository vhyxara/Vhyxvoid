'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useAdminAuthStore, getAdminRefreshToken } from '@/api/domain/auth/auth.store'
import { adminAuthService } from '@/api/infrastructure/auth.service'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/admin-users', label: 'Admin Users' },
  { href: '/roles', label: 'Roles' },
  { href: '/abilities', label: 'Abilities' },
  { href: '/audit-log', label: 'Audit Log' },
  { href: '/feedback', label: 'Feedback' }
]

export default function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const admin = useAdminAuthStore(s => s.admin)
  const clearSession = useAdminAuthStore(s => s.clearSession)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)

    try {
      const refreshToken = getAdminRefreshToken()

      if (refreshToken) {
        // Best-effort — revokes the AdminSession row server-side. Still
        // clear the local session and redirect even if this call fails
        // (e.g. the token was already expired/revoked), since the goal is
        // "this browser is signed out" regardless of server-side state.
        await adminAuthService.logout(refreshToken)
      }
    } catch (err: any) {
      toast.danger(err?.message ?? 'Logout request failed — signing out locally anyway.')
    } finally {
      clearSession()
      setLoggingOut(false)
      router.replace('/login')
    }
  }

  return (
    <div className='flex flex-col min-bs-screen'>
      <header className='flex items-center justify-between gap-4 p-4 border-be'>
        <nav className='flex items-center gap-4 flex-wrap'>
          {NAV_LINKS.map(link => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className='flex items-center gap-3'>
          {admin && <Typography variant='body2'>{admin.email}</Typography>}
          <Button variant='outline' size='sm' loading={loggingOut} onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      <main className='flex-1 p-6'>{children}</main>
    </div>
  )
}
