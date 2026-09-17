import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { adminAbilityKeys } from './admin-ability.keys'

/**
 * Same disjoint-query-key concern verified for adminRoleKeys/adminUserKeys
 * -- confirmed here too rather than assumed, since useCreateAbility/
 * useDeleteAbility (added this session) both invalidate via
 * adminAbilityKeys.all.
 */
describe('adminAbilityKeys — mutation invalidation actually reaches the list', () => {
  it('invalidating adminAbilityKeys.all invalidates list()', () => {
    const queryClient = new QueryClient()

    const list = adminAbilityKeys.list()

    queryClient.setQueryData(list, [])
    queryClient.invalidateQueries({ queryKey: adminAbilityKeys.all })

    expect(queryClient.getQueryCache().find({ queryKey: list })?.state.isInvalidated).toBe(true)
  })
})
