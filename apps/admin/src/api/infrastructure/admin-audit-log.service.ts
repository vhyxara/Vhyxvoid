import type { AdminAuditLogEntry } from '@/api/domain/admin-audit-log/admin-audit-log.types'
import { ADMIN_AUDIT_LOG_ENDPOINTS } from './admin-audit-log.endpoints'
import { httpClient } from '@/api/wrapper/http'

// auditLogsQuerySchema (admin.dto.ts): adminId/action/targetId are all
// optional and MUTUALLY EXCLUSIVE at the route level -- confirmed by
// reading admin.routes.ts directly, the handler branches
// `if (adminId) ... else if (action) ... else if (targetId) ... else
// findAll()`, so passing more than one has no combined-filter effect (only
// the highest-priority one present is honored). The UI only ever sends one
// at a time (a single "filter by" dropdown), matching this shape exactly
// rather than offering a combinable multi-filter form the backend can't
// actually do.
export type AuditLogQuery = {
  adminId?: string
  action?: string
  targetId?: string
  limit: number
  offset: number
}

function buildQuery(query: AuditLogQuery): string {
  const params = new URLSearchParams()

  if (query.adminId) params.set('adminId', query.adminId)
  else if (query.action) params.set('action', query.action)
  else if (query.targetId) params.set('targetId', query.targetId)

  params.set('limit', String(query.limit))
  params.set('offset', String(query.offset))

  return params.toString()
}

export const adminAuditLogService = {
  // NOTE: the response has NO total/count field at all -- confirmed by
  // reading AdminAuditLogRepository directly (no countAll() exists; the
  // three count-by-X methods it does have are never called by the route)
  // and via a real curl call. Callers requesting `limit + 1` and slicing
  // off the extra row is how this screen detects "is there a next page"
  // without a real total to build page-number pagination against.
  list: (query: AuditLogQuery) =>
    httpClient<AdminAuditLogEntry[]>({
      url: `${ADMIN_AUDIT_LOG_ENDPOINTS.LIST}?${buildQuery(query)}`,
      method: 'GET'
    })
}
