'use client'

import { useEffect } from 'react'

import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { bootstrapSession } from '@/api/infrastructure/bootstrap/bootstrapSession'

export function useBootstrapSession() {
  const bootstrapStatus = useAuthStore(s => s.bootstrapStatus)

  //   const setBootstrapStatus = useAuthStore(s => s.setBootstrapStatus)

  useEffect(() => {
    // Already ran or running — don't fire again
    if (bootstrapStatus !== 'idle') return
    bootstrapSession()
  }, [bootstrapStatus])

  return {
    isBootstrapping: bootstrapStatus !== 'done'
  }
}

export function useBootstrapReady() {
  return useAuthStore(s => s.bootstrapStatus === 'done')
}
