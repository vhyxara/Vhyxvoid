import { useQuery } from '@tanstack/react-query'

import { adminRoleKeys } from '@/api/infrastructure/query-keys/admin-role.keys'
import { adminRoleService } from '@/api/infrastructure/admin-role.service'

// Read-only for now -- used by Admin Users' role-assignment sub-view to
// populate the "add role" dropdown. Full Roles CRUD (Screen 4) will add
// mutations alongside this same query key.
export function useAdminRolesList() {
  return useQuery({
    queryKey: adminRoleKeys.list(),
    queryFn: () => adminRoleService.list()
  })
}
