import type { AdminRoleSummary } from '@/api/domain/admin-roles/admin-role.types'
import { ADMIN_ROLE_ENDPOINTS } from './admin-role.endpoints'
import { httpClient } from '@/api/wrapper/http'

export const adminRoleService = {
  list: () =>
    httpClient<AdminRoleSummary[]>({
      url: ADMIN_ROLE_ENDPOINTS.LIST,
      method: 'GET'
    })
}
