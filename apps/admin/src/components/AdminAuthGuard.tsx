'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { useRouter } from 'next/navigation'

import { Spinner } from '@vhyxui/react'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'

// Minimal route guard for the dashboard-shell placeholder (screen 2) and
// every stub screen nested under it. Deliberately simple -- this is not
// apps/web's AuthGuard.tsx copied over (that one bootstraps a session via
// a silent refresh against an httpOnly cookie on every page load, which
// has no admin-auth equivalent -- see http.ts's own comment on why). Here,
// `isAuthenticated` is read directly from the zustand store (rehydrated
// from sessionStorage synchronously on mount by zustand's persist
// middleware), and a missing session just redirects to /login. Building a
// real bootstrap/silent-refresh-on-load flow is dashboard-shell-proper
// scope for a later session, not this one's (Part 1's placeholder-shell
// ask), and would need @vhyx/api-kit's onUnauthorized path exercised on
// app mount rather than on first stale-token request, a different flow.
export default function AdminAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const isAuthenticated = useAdminAuthStore(s => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated) {
    return (
      <div className='flex items-center justify-center bs-full min-bs-screen'>
        <Spinner size='lg' />
      </div>
    )
  }

  return <>{children}</>
}
