import type { ReactNode } from 'react'

import { RequireRole } from './RequireRole'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'

type Props = {
  accountId: string
  children: ReactNode
  fallback?: ReactNode
}

// Shorthand — no prop drilling of minLevel at every call site
export function RequireOwner({ accountId, children, fallback }: Props) {
  return (
    <RequireRole accountId={accountId} minLevel={RoleLevel.OWNER} fallback={fallback}>
      {children}
    </RequireRole>
  )
}
