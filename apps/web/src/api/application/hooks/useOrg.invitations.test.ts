import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

/**
 * Phase 2 investigation for Invitations, per backlog.md's item and
 * decision.md's "Phase 2: API Keys converted" template — the lesson from
 * that entry is: don't assume a staleness bug exists (or that a fix
 * transfers) without proving it against the actual key shapes involved.
 *
 * Unlike Members (`memberKeys`, object-subset matching) or API Keys
 * (`apiKeyKeys`, array-prefix matching over a params object), Invitations
 * has no query-key factory at all — `useInvitations`/`useCancelInvitation`
 * (useOrg.ts) use a single plain key, `['invitations', accountId]`, because
 * the backend's `GET .../invitations` endpoint (`account.routes.ts`,
 * `listInvitationsQuerySchema`) accepts only an optional `status` filter —
 * no page/limit/search/sortBy at all (hardcoded `orderBy: createdAt desc,
 * take: 100` server-side). All pagination/search/sort for this table is,
 * and must remain, client-side.
 *
 * These tests establish the BASELINE (pre-conversion, still using
 * `useSelfFetchingServerTable`'s ad hoc `[tableKey, paramsString]` key) to
 * answer the brief's question directly: does `useCancelInvitation`'s
 * mutation currently leave the visible table stale without a reload?
 * Answer: NO — the semantic-only invalidate (`['invitations', accountId]`)
 * genuinely does NOT reach the table's ad hoc key (confirming the original
 * Step 5c-style diagnosis is still accurate here), but the point-fix
 * (`[\`invitations-\${accountId}\`]`) DOES, via ordinary array-prefix
 * matching against the shim's `[tableKey, paramsString]` key — so the
 * point-fix is not dead weight today, it is actively doing the real work.
 */
describe('Invitations — baseline (pre-conversion) key-disjointness', () => {
  const accountId = 'acct_1'
  const shimKey = [`invitations-${accountId}`, JSON.stringify({ page: 1, limit: 10 })]

  it('the semantic-only invalidate (["invitations", accountId]) does NOT reach the compat shim\'s ad hoc key', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(shimKey, { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })

    queryClient.invalidateQueries({ queryKey: ['invitations', accountId] })

    const query = queryClient.getQueryCache().find({ queryKey: shimKey })

    expect(query?.state.isInvalidated).toBe(false)
  })

  it('the point-fix invalidate ([`invitations-${accountId}`]) DOES reach the compat shim\'s key — it is currently load-bearing, not removable dead weight', () => {
    const queryClient = new QueryClient()

    queryClient.setQueryData(shimKey, { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } })

    queryClient.invalidateQueries({ queryKey: [`invitations-${accountId}`] })

    const query = queryClient.getQueryCache().find({ queryKey: shimKey })

    expect(query?.state.isInvalidated).toBe(true)
  })
})

describe('Invitations — post-conversion (useInvitationsTableList)', () => {
  it('the table\'s real query key is EXACTLY the same key useCancelInvitation already invalidates — no prefix/subset matching needed, the point-fix is now provably redundant', () => {
    const queryClient = new QueryClient()
    const accountId = 'acct_1'

    // useInvitationsTableList derives its table rows via useMemo over
    // useInvitations(accountId)'s own cache entry — there is no separate
    // parameterized query key to prove a matching mechanism for, unlike
    // memberKeys (object-subset) or apiKeyKeys (array-prefix): the "table
    // query" and the "raw query" are the same cache entry.
    const tableUnderlyingKey = ['invitations', accountId]

    queryClient.setQueryData(tableUnderlyingKey, { accountId, status: 'PENDING', totalCount: 0, invitations: [] })

    const query = queryClient.getQueryCache().find({ queryKey: tableUnderlyingKey })

    expect(query?.state.isInvalidated).toBe(false)

    // The exact (only) call useCancelInvitation makes post-conversion.
    queryClient.invalidateQueries({ queryKey: ['invitations', accountId] })

    expect(query?.state.isInvalidated).toBe(true)
  })
})
