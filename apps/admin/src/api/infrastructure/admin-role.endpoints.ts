// Real paths confirmed by reading admin.routes.ts directly (Screen 4
// session) -- same prefix convention as admin-user.endpoints.ts. No
// DELETE/deactivate/activate route exists for roles at all (confirmed via
// grep: AdminRole.entities.ts has deactivate()/activate()/canBeDeleted(),
// deactivateRoleUseCase is decorated on the fastify instance, but no route
// ever calls it) -- Roles only supports list/detail/create/update plus
// ability assignment.
export const ADMIN_ROLE_ENDPOINTS = {
  LIST: '/admin/identity/roles',
  CREATE: '/admin/identity/roles',
  DETAIL: (id: string) => `/admin/identity/roles/${id}`,
  UPDATE: (id: string) => `/admin/identity/roles/${id}`,
  ABILITIES: (roleId: string) => `/admin/identity/roles/${roleId}/abilities`,
  REVOKE_ABILITY: (roleId: string, abilityId: string) => `/admin/identity/roles/${roleId}/abilities/${abilityId}`
} as const
