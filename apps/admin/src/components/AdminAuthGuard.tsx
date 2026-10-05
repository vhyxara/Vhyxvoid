'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import { Spinner } from '@vhyxui/react'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { adminAuthService } from '@/api/infrastructure/auth.service'

/**
 * Gates the admin app. On a fresh page load the access token is gone (it is
 * memory-only), so the session is restored with one refresh call against the
 * httpOnly cookie, then the profile is loaded. No cookie, or a revoked one,
 * goes to /login with the current path in `next`, so a deep link survives
 * signing in (admin-frontend backlog: deep links used to land on /dashboard).
 */
export default function AdminAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const status = useAdminAuthStore(s => s.status)
  const started = useRef(false)

  useEffect(() => {
    if (status !== 'unknown' || started.current) return
    started.current = true
    const store = useAdminAuthStore.getState()

    adminAuthService
      .refresh()
      .then(async ({ accessToken }) => {
        store.setAccessToken(accessToken)
        const me = await adminAuthService.me()

        store.setAdmin({ id: me.id, email: me.email, fullName: me.fullName, isSuperAdmin: me.isSuperAdmin })
      })
      .catch(() => store.clearSession())
  }, [status])

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace(`/login${pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : ''}`)
    }
  }, [status, pathname, router])

  if (status !== 'authenticated') {
    return (
      <div className='flex items-center justify-center bs-full min-bs-screen'>
        <Spinner size='lg' />
      </div>
    )
  }

  return <>{children}</>
}
