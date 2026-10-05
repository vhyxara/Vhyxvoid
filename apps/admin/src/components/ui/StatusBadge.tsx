'use client'

import { Badge } from '@vhyxui/react'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'

const MAP: Record<string, Variant> = {
  ACTIVE: 'success',
  CONNECTED: 'success',
  PUBLISHED: 'success',
  PAID: 'success',
  ok: 'success',
  TRIALING: 'info',
  DRAFT: 'info',
  OPEN: 'info',
  PAST_DUE: 'warning',
  RESTRICTED: 'warning',
  INCOMPLETE: 'warning',
  UNPAID: 'warning',
  degraded: 'warning',
  EXPIRED: 'outline',
  DISCONNECTED: 'outline',
  ARCHIVED: 'outline',
  CANCELED: 'outline',
  VOID: 'outline',
  unknown: 'outline',
  SUSPENDED: 'danger',
  REVOKED: 'danger',
  DELETED: 'danger',
  EVICTED: 'danger',
  UNCOLLECTIBLE: 'danger',
  down: 'danger'
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <Badge variant='outline'>—</Badge>

  return (
    <Badge variant={MAP[status] ?? 'default'} size='sm'>
      {label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
    </Badge>
  )
}
