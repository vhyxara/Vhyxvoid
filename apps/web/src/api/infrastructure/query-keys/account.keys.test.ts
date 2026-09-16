import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { memberKeys, meKeys } from './account.keys'

/**
 * The concrete claim behind removing useMembers.ts's ad hoc
 * `members-${accountId}` second `invalidateQueries` call (Phase 2 pilot,
 * TABLE_API_ARCHITECTURE_COMPARISON.md Part 3): once the Members table's own
 * query is keyed through `memberKeys.list({accountId, ...params})` instead of
 * an ad hoc `[tableKey, params]` string, every mutation hook's existing
 * `invalidateQueries({queryKey: memberKeys.list({accountId})})` call already
 * invalidates it too, via React Query's default partial-key matching (a
 * filter key's object entries must all be present with equal values in the
 * actual key — the actual key may have more). This is exercised here against
 * a real QueryClient rather than just asserted from documentation.
 */
describe('memberKeys — partial-match invalidation (Phase 2 pilot proof)', () => {
  it('invalidating memberKeys.list({accountId}) also invalidates the Members table\'s own parameterized query', () => {
    const queryClient = new QueryClient()
    const accountId = 'acct_1'

    const tableQueryKey = memberKeys.list({ accountId, page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' })

    queryClient.setQueryData(tableQueryKey, {
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 1 }
    })

    const query = queryClient.getQueryCache().find({ queryKey: tableQueryKey })

    expect(query?.state.isInvalidated).toBe(false)

    // The exact call every mutation hook in useMembers.ts already makes.
    queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId }) })

    expect(query?.state.isInvalidated).toBe(true)
  })

  it('does NOT invalidate a different accountId\'s parameterized query', () => {
    const queryClient = new QueryClient()

    const otherAccountKey = memberKeys.list({ accountId: 'acct_2', page: 1, limit: 10 })

    queryClient.setQueryData(otherAccountKey, { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })

    queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId: 'acct_1' }) })

    const query = queryClient.getQueryCache().find({ queryKey: otherAccountKey })

    expect(query?.state.isInvalidated).toBe(false)
  })
})

/**
 * A real, previously-undiagnosed bug found while investigating My
 * Organizations for Phase 2 (see decision.md, 2026-09-16, "Phase 2: My
 * Organizations — accountKeys.all invalidation was a dead target, fixed").
 * `useCreateOrg`/`useUpdateProfile`/`useRenameOrg` (useOrg.ts) and
 * `useTransferOwnership`/`useAcceptInvitation` (useMembers.ts) all called
 * `queryClient.invalidateQueries({queryKey: accountKeys.all})` —
 * `accountKeys.all` evaluates to `['accounts']` (the now-deleted
 * `createQueryKeys<{userId?: string}>('accounts')`, `account.keys.ts`) —
 * but the ONLY live reader of "my organizations" data (`useMe`/
 * `useMyAccounts`/`useMyAccountsTableList`, `useMe.ts`) is keyed through
 * `meKeys.detail()`, which evaluates to `['me', 'detail']`. These two keys
 * share no common prefix, so this invalidation was a complete no-op against
 * the only cache entry that mattered — confirmed by grep: `accountKeys` had
 * zero real `useQuery` readers anywhere in the codebase, only these five
 * dead invalidation call sites. `CreateOrgDialog.tsx` had been masking this
 * specifically for the create-org case with a `window.location.reload()`
 * (removed once the real fix landed); renaming an org, transferring
 * ownership, and accepting an invitation had no such mask — the sidebar org
 * switcher and "My organizations" table genuinely stayed stale after each
 * of those three actions until a manual browser refresh, confirmed live in
 * the browser (not just from reading the code) before and after the fix.
 */
describe('accountKeys.all was a dead invalidation target (Phase 2 bug proof)', () => {
  it('["accounts"] (accountKeys.all\'s old value) does NOT invalidate meKeys.detail() — the only real cache entry for "my organizations"', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(meKeys.detail(), {
      id: 'user_1',
      accounts: [{ accountId: 'acct_1', accountName: 'Acme Corp' }]
    })

    const query = queryClient.getQueryCache().find({ queryKey: meKeys.detail() })

    expect(query?.state.isInvalidated).toBe(false)

    // The exact, now-removed call every affected mutation hook used to make.
    queryClient.invalidateQueries({ queryKey: ['accounts'] })

    expect(query?.state.isInvalidated).toBe(false)
  })

  it('meKeys.detail() (the fix) DOES invalidate the same cache entry useMe/useMyAccounts read from', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(meKeys.detail(), {
      id: 'user_1',
      accounts: [{ accountId: 'acct_1', accountName: 'Acme Corp' }]
    })

    queryClient.invalidateQueries({ queryKey: meKeys.detail() })

    const query = queryClient.getQueryCache().find({ queryKey: meKeys.detail() })

    expect(query?.state.isInvalidated).toBe(true)
  })
})
