'use client'
import type { ReactNode } from 'react'

import { usePermissions } from '@/api/application/hooks/usePermissions'

type Props = {
  accountId: string
  children: ReactNode
  unauthorizedPage?: ReactNode
}

// Wraps entire org-scoped routes — checks membership exists at all
export function AccountGuard({ accountId, children, unauthorizedPage }: Props) {
  const { myLevel, isLoading } = usePermissions(accountId)

  console.log('AccountGuard', myLevel, isLoading)
  if (isLoading) return null

  // myLevel === 0 means no membership found
  if (myLevel === 0) {
    return <>{unauthorizedPage ?? <p>You are not a member of this account.</p>}</>
  }

  return <>{children}</>
}
