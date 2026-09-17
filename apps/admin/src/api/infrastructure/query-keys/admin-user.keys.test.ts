import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { adminUserKeys } from './admin-user.keys'

/**
 * The disjoint-query-key staleness bug (internal-tools/user-frontend/
 * context.md item 34: a table's own internal query key disjoint from the
 * semantic key a mutation invalidates, so a successful mutation persists
 * but the visible table never refreshes) structurally cannot recur here
 * the way it did in apps/web's pre-Phase-2 GenericServerTable -- this
 * app's copy is already the post-fix, props-based version (data/isLoading/
 * error/total passed in, no internal useQuery of its own). But per the
 * brief's explicit instruction not to assume immunity just because the app
 * is new, this proves the actual invalidation call every mutation hook in
 * useAdminUsers.ts makes (`adminUserKeys.all`) really does reach every
 * `adminUserKeys.list({status})` variant, via React Query's own partial-
 * key matching -- not asserted, verified against a real QueryClient.
 */
describe('adminUserKeys — mutation invalidation actually reaches every list variant', () => {
  it('invalidating adminUserKeys.all invalidates list({}), list({status: true}), and list({status: false}) all at once', () => {
    const queryClient = new QueryClient()

    const unfiltered = adminUserKeys.list({})
    const activeOnly = adminUserKeys.list({ status: true })
    const disabledOnly = adminUserKeys.list({ status: false })

    queryClient.setQueryData(unfiltered, [])
    queryClient.setQueryData(activeOnly, [])
    queryClient.setQueryData(disabledOnly, [])

    queryClient.invalidateQueries({ queryKey: adminUserKeys.all })

    expect(queryClient.getQueryCache().find({ queryKey: unfiltered })?.state.isInvalidated).toBe(true)
    expect(queryClient.getQueryCache().find({ queryKey: activeOnly })?.state.isInvalidated).toBe(true)
    expect(queryClient.getQueryCache().find({ queryKey: disabledOnly })?.state.isInvalidated).toBe(true)
  })

  it('invalidating adminUserKeys.detail(id) does NOT invalidate an unrelated detail entry (precise, not over-broad)', () => {
    const queryClient = new QueryClient()

    const detailA = adminUserKeys.detail('admin-a')
    const detailB = adminUserKeys.detail('admin-b')

    queryClient.setQueryData(detailA, {})
    queryClient.setQueryData(detailB, {})

    queryClient.invalidateQueries({ queryKey: detailA })

    expect(queryClient.getQueryCache().find({ queryKey: detailA })?.state.isInvalidated).toBe(true)
    expect(queryClient.getQueryCache().find({ queryKey: detailB })?.state.isInvalidated).toBe(false)
  })

  it('list({}) and list({status: true}) are genuinely different cache entries, not accidentally collapsed to the same key', () => {
    expect(adminUserKeys.list({})).not.toEqual(adminUserKeys.list({ status: true }))
  })
})
