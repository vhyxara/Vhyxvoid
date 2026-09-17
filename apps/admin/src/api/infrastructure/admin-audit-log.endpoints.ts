// Real path confirmed by reading admin.routes.ts directly: GET
// /admin/audit-logs, mounted under the same /api/v1/admin/identity prefix
// as every other admin.routes.ts route (identity/presentation/http/index.ts).
export const ADMIN_AUDIT_LOG_ENDPOINTS = {
  LIST: '/admin/identity/audit-logs'
} as const
