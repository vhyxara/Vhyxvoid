// GET /admin/identity/roles's real response shape, confirmed via curl
// against the live local dev backend. Roles is its own future screen
// (Screen 4) -- this type lives here now only because Admin Users' role-
// assignment sub-view needs the list of assignable roles; Screen 4 should
// reuse this type rather than redefining it.
export type AdminRoleSummary = {
  id: string
  name: string
  description?: string
  isSystem: boolean
  isActive: boolean
}
