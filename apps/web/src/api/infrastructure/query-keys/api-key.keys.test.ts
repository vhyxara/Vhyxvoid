import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { apiKeyKeys } from './api-key.keys'

/**
 * The concrete claim behind removing useApiKeys.ts's ad hoc
 * `api-keys-${accountId}` second `invalidateQueries` call (Phase 2,
 * TABLE_API_ARCHITECTURE_COMPARISON.md Part 3, following the pattern
 * proven on Members — see decision.md, 2026-09-15, "Phase 2: API Keys
 * converted to props-based table pattern"): once the API Keys table's own
 * query is keyed through `apiKeyKeys.list(accountId, params)` instead of an
 * ad hoc `[tableKey, params]` string, every mutation hook's existing
 * `invalidateQueries({queryKey: apiKeyKeys.lists(accountId)})` /
 * `apiKeyKeys.all(accountId)` call already invalidates it too — via React
 * Query's default array-prefix matching (a shorter filter key array
 * matches any actual key that starts with the same elements; unlike
 * `memberKeys`, `apiKeyKeys` isn't built on `createQueryKeys`'s
 * object-params shape, so this is prefix matching on plain array elements,
 * not object-subset matching — a different mechanism than the Members
 * proof, verified separately here). Exercised against a real QueryClient
 * rather than just asserted from documentation.
 */
describe('apiKeyKeys — array-prefix invalidation (Phase 2 proof)', () => {
  it('invalidating apiKeyKeys.lists(accountId) also invalidates the API Keys table\'s own parameterized query', () => {
    const queryClient = new QueryClient()
    const accountId = 'acct_1'

    const tableQueryKey = apiKeyKeys.list(accountId, { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' })

    queryClient.setQueryData(tableQueryKey, {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 1 }
    })

    const query = queryClient.getQueryCache().find({ queryKey: tableQueryKey })

    expect(query?.state.isInvalidated).toBe(false)

    // The exact call useCreateApiKey/useUpdateApiKey/useRevokeApiKey already make.
    queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists(accountId) })

    expect(query?.state.isInvalidated).toBe(true)
  })

  it('invalidating apiKeyKeys.all(accountId) (useRotateApiKey\'s call) also invalidates the table\'s query', () => {
    const queryClient = new QueryClient()
    const accountId = 'acct_1'

    const tableQueryKey = apiKeyKeys.list(accountId, { page: 1, limit: 10 })

    queryClient.setQueryData(tableQueryKey, { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })

    queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(accountId) })

    const query = queryClient.getQueryCache().find({ queryKey: tableQueryKey })

    expect(query?.state.isInvalidated).toBe(true)
  })

  it('does NOT invalidate a different accountId\'s parameterized query', () => {
    const queryClient = new QueryClient()

    const otherAccountKey = apiKeyKeys.list('acct_2', { page: 1, limit: 10 })

    queryClient.setQueryData(otherAccountKey, { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })

    queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists('acct_1') })

    const query = queryClient.getQueryCache().find({ queryKey: otherAccountKey })

    expect(query?.state.isInvalidated).toBe(false)
  })
})
