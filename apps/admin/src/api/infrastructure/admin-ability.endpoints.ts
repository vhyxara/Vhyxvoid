// GET-only for now -- Roles' ability-assignment sub-view needs the full
// ability list; a real Screen 5 (create/delete abilities) adds the rest of
// these paths when built. GET /admin/identity/abilities has zero query
// params (no listAbilitiesSchema exists; isActive: true is hardcoded
// server-side), confirmed by reading admin.dto.ts and admin.routes.ts
// directly.
export const ADMIN_ABILITY_ENDPOINTS = {
  LIST: '/admin/identity/abilities'
} as const
