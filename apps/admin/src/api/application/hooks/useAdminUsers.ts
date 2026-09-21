import { useMemo } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import { adminUserKeys } from '@/api/infrastructure/query-keys/admin-user.keys'
import { adminUserService, type CreateAdminDTO, type UpdateAdminProfileDTO } from '@/api/infrastructure/admin-user.service'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { parseStatusFilter, paginateAdminUsers } from './adminUsersTable.util'

// The real, server-backed query -- GET /admin/identity/users?status=...
export function useAdminUsers(status?: boolean) {
  return useQuery({
    queryKey: adminUserKeys.list({ status }),
    queryFn: () => adminUserService.list(status)
  })
}

/**
 * Admin Users table's own real query. GET /admin/identity/users has
 * exactly one real server-side dimension (an optional `status` filter,
 * confirmed by reading listAdminsSchema directly -- no page/limit/sort/
 * search at all). `status` is treated as the genuine server param it is
 * (a real refetch on change, keyed via adminUserKeys.list({status}), same
 * as every real param Members/API Keys use) -- search/sort/pagination
 * happen client-side over the resulting batch (paginateAdminUsers, its own
 * directly-tested pure function), the same adaptation established for
 * Invitations (internal-tools/user-frontend/context.md item 47) when a
 * backend genuinely doesn't support the rest. See
 * internal-tools/admin-frontend/decision.md, 2026-09-17 ("Screen 3").
 */
export function useAdminUsersTableList(params: FetchParams) {
  const cleanParams = cleanTableParams(params)
  const status = parseStatusFilter(cleanParams.filters?.status)
  const query = useAdminUsers(status)

  const data = useMemo(() => {
    if (!query.data) return undefined

    return paginateAdminUsers(query.data, cleanParams)
  }, [query.data, cleanParams.search, cleanParams.sortBy, cleanParams.sortOrder, cleanParams.page, cleanParams.limit])

  return { data, isLoading: query.isLoading, error: query.error }
}

export function useAdminUserDetail(id: string) {
  return useQuery({
    queryKey: adminUserKeys.detail(id),
    queryFn: () => adminUserService.get(id),
    enabled: !!id
  })
}

export function useCreateAdmin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateAdminDTO) => adminUserService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
    }
  })
}

// PUT /admin/identity/users/:id -- name only (see UpdateAdminProfileDTO). The
// signed-in admin's own name lives in the auth store too (DashboardShell shows
// it), so editing yourself must update it or the header keeps the old name.
export function useUpdateAdmin(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateAdminProfileDTO) => adminUserService.update(id, data),
    onSuccess: updated => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(id) })

      useAdminAuthStore.setState(state =>
        state.admin?.id === id ? { admin: { ...state.admin, fullName: updated.fullName } } : state
      )
    }
  })
}

export function useDisableAdmin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => adminUserService.disable(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(id) })
    }
  })
}

export function useEnableAdmin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => adminUserService.enable(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(id) })
    }
  })
}

export function useAssignRoleToAdmin(adminId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roleId: string) => adminUserService.assignRole(adminId, roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(adminId) })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
    }
  })
}

export function useRevokeRoleFromAdmin(adminId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roleId: string) => adminUserService.revokeRole(adminId, roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(adminId) })
      queryClient.invalidateQueries({ queryKey: adminUserKeys.all })
    }
  })
}
