'use client'
import type { ReactNode } from 'react'

import { usePermissions } from '@/api/application/hooks/usePermissions'

import { type RoleLevel } from '@/api/domain/identity/enums/role.enum'

type Props = {
  accountId: string
  minLevel: RoleLevel
  children: ReactNode
  fallback?: ReactNode // what to render when access denied — default null
}

export function RequireRole({ accountId, minLevel, children, fallback = null }: Props) {
  const { myLevel, isLoading } = usePermissions(accountId)

  // While membership is loading, render nothing — avoids flashing restricted UI
  if (isLoading) return null

  if (myLevel < minLevel) return <>{fallback}</>

  return <>{children}</>
}
