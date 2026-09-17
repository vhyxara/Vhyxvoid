// Shapes matching apps/api's real admin-user responses exactly, confirmed
// by reading admin.routes.ts directly and via real curl calls against the
// live local dev backend (see internal-tools/admin-frontend/decision.md) --
// not assumed from the DTO file alone. `status` is a plain boolean
// (true = active), not a string enum -- confirmed via AdminUser.entities.ts.

export type AdminUserSummary = {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  isSuperAdmin: boolean
  status: boolean
  lastLoginAt: string | null
}

export type AdminRoleRef = {
  id: string
  name: string
}

// GET /admin/identity/users/:id's real response shape -- summary fields
// plus the admin's currently-assigned roles (id/name only, not the full
// AdminRoleSummary shape -- confirmed by reading the route handler
// directly: `roles.map((r) => ({ id: r.id, name: r.name }))`).
export type AdminUserDetail = AdminUserSummary & {
  roles: AdminRoleRef[]
}
