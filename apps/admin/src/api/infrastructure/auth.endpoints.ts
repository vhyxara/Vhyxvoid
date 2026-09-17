// Real paths confirmed by reading admin.routes.ts and
// identity/presentation/http/index.ts directly (prefix: /api/v1/admin/identity)
// -- see internal-tools/admin-frontend/context.md's Part 1.
export const ADMIN_AUTH_ENDPOINTS = {
  LOGIN: '/admin/identity/auth/login',
  REFRESH: '/admin/identity/auth/refresh',
  LOGOUT: '/admin/identity/auth/logout',
  ME: '/admin/identity/me',
  ME_ABILITIES: '/admin/identity/me/abilities'
} as const
