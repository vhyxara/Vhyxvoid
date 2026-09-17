// Real paths confirmed by reading admin.routes.ts directly (prefix:
// /api/v1/admin/identity, see api/infrastructure/auth.endpoints.ts's own
// identical convention). GET /users/:id and POST /users/:id/disable had a
// real route-param bug (destructured `adminId` from a route registered
// with `:id` -- always undefined) fixed in apps/api the same session this
// screen was built -- see internal-tools/api/decision.md.
export const ADMIN_USER_ENDPOINTS = {
  LIST: '/admin/identity/users',
  CREATE: '/admin/identity/users',
  DETAIL: (id: string) => `/admin/identity/users/${id}`,
  UPDATE: (id: string) => `/admin/identity/users/${id}`,
  DISABLE: (id: string) => `/admin/identity/users/${id}/disable`,
  ENABLE: (id: string) => `/admin/identity/users/${id}/enable`,
  ASSIGN_ROLE: (adminId: string) => `/admin/identity/users/${adminId}/roles`,
  REVOKE_ROLE: (adminId: string, roleId: string) => `/admin/identity/users/${adminId}/roles/${roleId}`
} as const
