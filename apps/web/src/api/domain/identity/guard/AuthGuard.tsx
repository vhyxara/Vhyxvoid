'use client'
import { useEffect } from 'react'

import { useRouter } from 'next/navigation'

import { CircularProgress } from '@mui/material'

import { useAuthStore } from '../store/auth.store'

type Props = {
  children: React.ReactNode
  redirectTo?: string
}

export function AuthGuard({ children, redirectTo = '/login' }: Props) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const bootstrapStatus = useAuthStore(s => s.bootstrapStatus)
  const router = useRouter()

  const isBootstrapping = bootstrapStatus !== 'done'

  useEffect(() => {
    // Only redirect after bootstrap has finished evaluating the session
    if (!isBootstrapping && !isAuthenticated) {
      router.replace(redirectTo)
    }
  }, [isBootstrapping, isAuthenticated, redirectTo, router])

  // Hold render while bootstrap is in flight
  //   if (isBootstrapping) return null
  // inside AuthGuard, replace the isBootstrapping null return:
  if (isBootstrapping) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </div>
    )
  }

  if (!isAuthenticated) return null

  return <>{children}</>
}
