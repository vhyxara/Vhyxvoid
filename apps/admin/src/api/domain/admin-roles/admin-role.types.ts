// GET /admin/identity/roles's real response shape, confirmed via curl
// against the live local dev backend. Roles is its own future screen
// (Screen 4) -- this type lives here now only because Admin Users' role-
// assignment sub-view needs the list of assignable roles; Screen 4 should
// reuse this type rather than redefining it.
//
// `description` corrected to `string | null` (Screen 4 session) -- the
// prior `description?: string` was never actually verified against the
// real entity; AdminRoleProps types it `string | null`, and the route
// handler passes `role.description` straight through with no coercion.
export type AdminRoleSummary = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  isActive: boolean
}

// GET /admin/identity/roles/:id's real response shape -- summary fields
// plus createdAt/updatedAt, confirmed by reading the route handler
// directly.
export type AdminRoleDetail = AdminRoleSummary & {
  createdAt: string
  updatedAt: string
}

// The abilities a role has, per GET /admin/identity/roles/:roleId/abilities
// -- same shape as the full ability list (AdminAbilitySummary), not a
// narrower {id, name} ref the way AdminUserDetail.roles is -- confirmed by
// reading the route handler directly.
export type AdminRoleAbility = {
  id: string
  action: string
  category: string
  description?: string
  isSystem: boolean
  isActive: boolean
}
