import { useQuery } from '@tanstack/react-query'

import { adminAuditLogKeys } from '@/api/infrastructure/query-keys/admin-audit-log.keys'
import { adminAuditLogService, type AuditLogQuery } from '@/api/infrastructure/admin-audit-log.service'
import type { AdminAuditLogEntry } from '@/api/domain/admin-audit-log/admin-audit-log.types'

export type AuditLogFilterType = 'none' | 'admin' | 'action' | 'target'

export type AuditLogFilter = {
  type: AuditLogFilterType
  value: string
}

// adminId/action/targetId are mutually exclusive server-side (see
// admin-audit-log.service.ts) -- the UI only ever sends one, matching the
// real contract rather than a combinable filter form the backend can't do.
export function buildAuditLogQuery(filter: AuditLogFilter, page: number, limit: number): AuditLogQuery {
  const offset = (page - 1) * limit

  // Over-fetch by one row so the caller can tell whether a next page
  // exists without a real total -- confirmed no total/count field exists
  // anywhere in the response (see admin-audit-log.types.ts). The extra row
  // is sliced off before rendering.
  const overfetchLimit = limit + 1

  const base: AuditLogQuery = { limit: overfetchLimit, offset }

  if (filter.type === 'admin' && filter.value) return { ...base, adminId: filter.value }
  if (filter.type === 'action' && filter.value) return { ...base, action: filter.value }
  if (filter.type === 'target' && filter.value) return { ...base, targetId: filter.value }

  return base
}

// The over-fetched row (limit + 1, see buildAuditLogQuery) is how a "next
// page exists" signal is derived without a real total from the backend.
// Extracted as its own pure function so the slicing logic is directly
// testable without a QueryClient.
export function sliceAuditLogPage(
  rows: AdminAuditLogEntry[],
  limit: number
): { items: AdminAuditLogEntry[]; hasNextPage: boolean } {
  const hasNextPage = rows.length > limit

  return { items: hasNextPage ? rows.slice(0, limit) : rows, hasNextPage }
}

export function useAdminAuditLogList(filter: AuditLogFilter, page: number, limit: number) {
  const query = buildAuditLogQuery(filter, page, limit)

  const result = useQuery({
    queryKey: adminAuditLogKeys.list(query),
    queryFn: () => adminAuditLogService.list(query)
  })

  const { items, hasNextPage } = sliceAuditLogPage(result.data ?? [], limit)

  return { items, hasNextPage, isLoading: result.isLoading, error: result.error }
}
