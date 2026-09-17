import type { AdminRoleAbility, AdminRoleDetail, AdminRoleSummary } from '@/api/domain/admin-roles/admin-role.types'
import { ADMIN_ROLE_ENDPOINTS } from './admin-role.endpoints'
import { httpClient } from '@/api/wrapper/http'

export type CreateRoleDTO = {
  name: string
  description?: string
}

export type UpdateRoleDTO = {
  name?: string
  description?: string
}

export const adminRoleService = {
  list: () =>
    httpClient<AdminRoleSummary[]>({
      url: ADMIN_ROLE_ENDPOINTS.LIST,
      method: 'GET'
    }),

  get: (id: string) =>
    httpClient<AdminRoleDetail>({
      url: ADMIN_ROLE_ENDPOINTS.DETAIL(id),
      method: 'GET'
    }),

  // POST /roles' real response omits isSystem/isActive (confirmed via
  // curl) -- narrower than AdminRoleSummary, same reasoning as
  // adminUserService.create()'s own narrow {id,email,fullName} return type.
  // Callers don't render this response directly (the dialog just closes and
  // the invalidated list re-fetches the full shape).
  create: (data: CreateRoleDTO) =>
    httpClient<{ id: string; name: string; description?: string }>({
      url: ADMIN_ROLE_ENDPOINTS.CREATE,
      method: 'POST',
      data
    }),

  // Rejected with a 409 CONFLICT ("System roles cannot be modified") for a
  // system role -- confirmed via curl against the live backend
  // (AdminRole.entities.ts's update() calls validateNotSystem()). The
  // detail view disables the edit form for isSystem roles rather than
  // letting this fail.
  update: (id: string, data: UpdateRoleDTO) =>
    httpClient<AdminRoleSummary>({
      url: ADMIN_ROLE_ENDPOINTS.UPDATE(id),
      method: 'PUT',
      data
    }),

  listAbilities: (roleId: string) =>
    httpClient<AdminRoleAbility[]>({
      url: ADMIN_ROLE_ENDPOINTS.ABILITIES(roleId),
      method: 'GET'
    }),

  // NO isSystem guard exists on this or revokeAbility -- confirmed by
  // reading AssignAbilityToRoleUseCase directly and empirically via curl
  // (successfully assigned/revoked an ability on a system role). Unlike
  // update(), this is intentionally left enabled for system roles.
  assignAbility: (roleId: string, abilityId: string) =>
    httpClient<void>({
      url: ADMIN_ROLE_ENDPOINTS.ABILITIES(roleId),
      method: 'POST',
      data: { abilityId }
    }),

  revokeAbility: (roleId: string, abilityId: string) =>
    httpClient<void>({
      url: ADMIN_ROLE_ENDPOINTS.REVOKE_ABILITY(roleId, abilityId),
      method: 'DELETE'
    })
}
