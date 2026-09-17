import { useQuery } from '@tanstack/react-query'

import { adminAbilityKeys } from '@/api/infrastructure/query-keys/admin-ability.keys'
import { adminAbilityService } from '@/api/infrastructure/admin-ability.service'

// Read-only for now -- used by Roles' ability-assignment sub-view to
// populate the "add ability" dropdown. A real Screen 5 (create/delete
// abilities) will add mutations alongside this same query key.
export function useAdminAbilitiesList() {
  return useQuery({
    queryKey: adminAbilityKeys.list(),
    queryFn: () => adminAbilityService.list()
  })
}
