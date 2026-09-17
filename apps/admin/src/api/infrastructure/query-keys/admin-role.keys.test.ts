import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { adminRoleKeys } from './admin-role.keys'

/**
 * Same disjoint-query-key concern verified for adminUserKeys
 * (admin-user.keys.test.ts) -- confirmed here too rather than assumed,
 * since GET /roles has a different shape (zero real params, one list
 * variant) and useCreateRole/useUpdateRole both invalidate via
 * adminRoleKeys.all.
 */
describe('adminRoleKeys — mutation invalidation actually reaches the list', () => {
  it('invalidating adminRoleKeys.all invalidates list()', () => {
    const queryClient = new QueryClient()

    const list = adminRoleKeys.list()

    queryClient.setQueryData(list, [])
    queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })

    expect(queryClient.getQueryCache().find({ queryKey: list })?.state.isInvalidated).toBe(true)
  })

  it('invalidating adminRoleKeys.detail(id) does NOT invalidate an unrelated detail entry (precise, not over-broad)', () => {
    const queryClient = new QueryClient()

    const detailA = adminRoleKeys.detail('role-a')
    const detailB = adminRoleKeys.detail('role-b')

    queryClient.setQueryData(detailA, {})
    queryClient.setQueryData(detailB, {})

    queryClient.invalidateQueries({ queryKey: detailA })

    expect(queryClient.getQueryCache().find({ queryKey: detailA })?.state.isInvalidated).toBe(true)
    expect(queryClient.getQueryCache().find({ queryKey: detailB })?.state.isInvalidated).toBe(false)
  })

  it('invalidating adminRoleKeys.all also invalidates every detail entry (React Query prefix matching)', () => {
    const queryClient = new QueryClient()

    const detailA = adminRoleKeys.detail('role-a')

    queryClient.setQueryData(detailA, {})
    queryClient.invalidateQueries({ queryKey: adminRoleKeys.all })

    expect(queryClient.getQueryCache().find({ queryKey: detailA })?.state.isInvalidated).toBe(true)
  })
})
