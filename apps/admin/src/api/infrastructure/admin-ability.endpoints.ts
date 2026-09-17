// GET /admin/identity/abilities has zero query params (no
// listAbilitiesSchema exists; isActive: true is hardcoded server-side),
// confirmed by reading admin.dto.ts and admin.routes.ts directly. No
// PUT/edit endpoint exists for abilities at all -- create + delete only.
export const ADMIN_ABILITY_ENDPOINTS = {
  LIST: '/admin/identity/abilities',
  CREATE: '/admin/identity/abilities',
  DELETE: (id: string) => `/admin/identity/abilities/${id}`
} as const
