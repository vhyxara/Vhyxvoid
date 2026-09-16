import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { feedbackKeys } from './feedback.keys'

/**
 * The concrete claim behind wiring FeedbackHistoryTab.tsx onto
 * `useMyFeedbackTableList` instead of the `useSelfFetchingServerTable`
 * compat shim (Phase 2, sixth table — see decision.md, 2026-09-16, "Phase
 * 2: My Feedback converted"): once the table's own query is keyed through
 * `feedbackKeys.list(params)` (the same hand-written, array-prefix-based
 * factory `useMyFeedback` already used, just not wired into this table),
 * `useSubmitFeedback`'s existing `invalidateQueries({queryKey:
 * feedbackKeys.lists()})` call already invalidates it — via React Query's
 * default array-prefix matching, the same mechanism already proven for
 * `apiKeyKeys`/`tunnelKeys`, verified separately here since `feedbackKeys`
 * is its own factory instance, not assumed to inherit the others' proof.
 */
describe('feedbackKeys — array-prefix invalidation (Phase 2 proof)', () => {
  it('invalidating feedbackKeys.lists() (useSubmitFeedback\'s call) also invalidates the table\'s own parameterized query', () => {
    const queryClient = new QueryClient()

    const tableQueryKey = feedbackKeys.list({ page: 1, limit: 20 })

    queryClient.setQueryData(tableQueryKey, {
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 1 }
    })

    const query = queryClient.getQueryCache().find({ queryKey: tableQueryKey })

    expect(query?.state.isInvalidated).toBe(false)

    queryClient.invalidateQueries({ queryKey: feedbackKeys.lists() })

    expect(query?.state.isInvalidated).toBe(true)
  })

  it('does NOT invalidate a detail query for a single feedback item', () => {
    const queryClient = new QueryClient()

    const detailKey = feedbackKeys.detail('fb_1')

    queryClient.setQueryData(detailKey, { id: 'fb_1' })

    queryClient.invalidateQueries({ queryKey: feedbackKeys.lists() })

    const query = queryClient.getQueryCache().find({ queryKey: detailKey })

    expect(query?.state.isInvalidated).toBe(false)
  })
})
