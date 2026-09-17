import type { AdminAbilitySummary } from '@/api/domain/admin-abilities/admin-ability.types'
import { ADMIN_ABILITY_ENDPOINTS } from './admin-ability.endpoints'
import { httpClient } from '@/api/wrapper/http'

export const adminAbilityService = {
  list: () =>
    httpClient<AdminAbilitySummary[]>({
      url: ADMIN_ABILITY_ENDPOINTS.LIST,
      method: 'GET'
    })
}
