import type { AdminUserDetail, AdminUserSummary } from '@/api/domain/admin-users/admin-user.types'
import { ADMIN_USER_ENDPOINTS } from './admin-user.endpoints'
import { httpClient } from '@/api/wrapper/http'

export type CreateAdminDTO = {
  email: string
  password: string
  firstName: string
  lastName: string
}

export const adminUserService = {
  // GET /admin/identity/users' only real server param is `status` --
  // confirmed by reading listAdminsSchema directly (admin.dto.ts). Built
  // inline rather than via a shared query-string helper -- one optional
  // boolean doesn't warrant apps/web's full buildQuery/appendParams utility.
  list: (status?: boolean) =>
    httpClient<AdminUserSummary[]>({
      url: status !== undefined ? `${ADMIN_USER_ENDPOINTS.LIST}?status=${status}` : ADMIN_USER_ENDPOINTS.LIST,
      method: 'GET'
    }),

  get: (id: string) =>
    httpClient<AdminUserDetail>({
      url: ADMIN_USER_ENDPOINTS.DETAIL(id),
      method: 'GET'
    }),

  create: (data: CreateAdminDTO) =>
    httpClient<{ id: string; email: string; fullName: string }>({
      url: ADMIN_USER_ENDPOINTS.CREATE,
      method: 'POST',
      data
    }),

  disable: (id: string) =>
    httpClient<void>({
      url: ADMIN_USER_ENDPOINTS.DISABLE(id),
      method: 'POST'
    }),

  enable: (id: string) =>
    httpClient<void>({
      url: ADMIN_USER_ENDPOINTS.ENABLE(id),
      method: 'POST'
    }),

  assignRole: (adminId: string, roleId: string) =>
    httpClient<void>({
      url: ADMIN_USER_ENDPOINTS.ASSIGN_ROLE(adminId),
      method: 'POST',
      data: { roleId }
    }),

  revokeRole: (adminId: string, roleId: string) =>
    httpClient<void>({
      url: ADMIN_USER_ENDPOINTS.REVOKE_ROLE(adminId, roleId),
      method: 'DELETE'
    })
}
