import { useMemo } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import { adminAbilityKeys } from '@/api/infrastructure/query-keys/admin-ability.keys'
import { adminAbilityService, type CreateAbilityDTO } from '@/api/infrastructure/admin-ability.service'
import { paginateAdminAbilities } from './adminAbilitiesTable.util'

// Also used by Roles' ability-assignment sub-view to populate the "add
// ability" dropdown (added during Screen 4, before create/delete existed).
export function useAdminAbilitiesList() {
  return useQuery({
    queryKey: adminAbilityKeys.list(),
    queryFn: () => adminAbilityService.list()
  })
}

/**
 * Admin Abilities table's own real query. GET /admin/identity/abilities has
 * ZERO real server params (same shape as Roles) -- search/sort/pagination
 * all happen client-side over the one fetched batch, via
 * paginateAdminAbilities, its own directly-tested pure function.
 */
export function useAdminAbilitiesTableList(params: FetchParams) {
  const cleanParams = cleanTableParams(params)
  const query = useAdminAbilitiesList()

  const data = useMemo(() => {
    if (!query.data) return undefined

    return paginateAdminAbilities(query.data, cleanParams)
  }, [query.data, cleanParams.search, cleanParams.sortBy, cleanParams.sortOrder, cleanParams.page, cleanParams.limit])

  return { data, isLoading: query.isLoading, error: query.error }
}

export function useCreateAbility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateAbilityDTO) => adminAbilityService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminAbilityKeys.all })
    }
  })
}

export function useDeleteAbility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => adminAbilityService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminAbilityKeys.all })
    }
  })
}
