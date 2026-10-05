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
  // The response carries `meta: { total, limit, offset }` next to `data`
  // (api CA-0038), so the whole envelope is read (raw).
  list: async (query: AuditLogQuery) => {
    const res = await httpClient<{ data: AdminAuditLogEntry[]; meta?: { total: number } }>({
      url: `${ADMIN_AUDIT_LOG_ENDPOINTS.LIST}?${buildQuery(query)}`,
      method: 'GET',
      raw: true
    })

    return { rows: res.data ?? [], total: res.meta?.total ?? null }
  }
}
