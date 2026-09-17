import { useMemo } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import { adminRoleKeys } from '@/api/infrastructure/query-keys/admin-role.keys'
import { adminRoleService, type CreateRoleDTO, type UpdateRoleDTO } from '@/api/infrastructure/admin-role.service'
import { paginateAdminRoles } from './adminRolesTable.util'

// Read-only for now -- also used by Admin Users' role-assignment sub-view
// to populate the "add role" dropdown.
export function useAdminRolesList() {
  return useQuery({
    queryKey: adminRoleKeys.list(),
    queryFn: () => adminRoleService.list()
  })
}

/**
 * Admin Roles table's own real query. GET /admin/identity/roles has ZERO
 * real server params (no listRolesSchema exists at all -- confirmed by
 * reading admin.dto.ts directly) -- search/sort/pagination all happen
 * client-side over the one fetched batch (paginateAdminRoles, its own
 * directly-tested pure function). See internal-tools/admin-frontend/
 * decision.md, Screen 4 entry.
 */
export function useAdminRolesTableList(params: FetchParams) {
  const cleanParams = cleanTableParams(params)
  const query = useAdminRolesList()

  const data = useMemo(() => {
    if (!query.data) return undefined

    return paginateAdminRoles(query.data, cleanParams)
  }, [query.data, cleanParams.search, cleanParams.sortBy, cleanParams.sortOrder, cleanParams.page, cleanParams.limit])

  return { data, isLoading: query.isLoading, error: query.error }
}

export function useAdminRoleDetail(id: string) {
  return useQuery({
    queryKey: adminRoleKeys.detail(id),
    queryFn: () => adminRoleService.get(id),
    enabled: !!id
  })
}

export function useCreateRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateRoleDTO) => adminRoleService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })
    }
  })
}

export function useUpdateRole(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateRoleDTO) => adminRoleService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })
      queryClient.invalidateQueries({ queryKey: adminRoleKeys.detail(id) })
    }
  })
}

// A role's assigned abilities don't fit the createQueryKeys {list, detail}
// shape (it's a sub-resource under one role, not its own top-level
// collection) -- a hand-built key, same convention as apps/web's
// useOrg.ts's `['invitations', accountId]` for the equivalent case.
function roleAbilitiesKey(roleId: string) {
  return ['admin-role-abilities', roleId] as const
}

export function useRoleAbilities(roleId: string) {
  return useQuery({
    queryKey: roleAbilitiesKey(roleId),
    queryFn: () => adminRoleService.listAbilities(roleId),
    enabled: !!roleId
  })
}

// No isSystem guard on either mutation, confirmed via curl against the live
// backend -- left enabled for system roles, unlike useUpdateRole.
export function useAssignAbilityToRole(roleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (abilityId: string) => adminRoleService.assignAbility(roleId, abilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleAbilitiesKey(roleId) })
    }
  })
}

export function useRevokeAbilityFromRole(roleId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (abilityId: string) => adminRoleService.revokeAbility(roleId, abilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roleAbilitiesKey(roleId) })
    }
  })
}
