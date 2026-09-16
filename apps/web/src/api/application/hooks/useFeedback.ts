import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import toast from 'react-hot-toast'

import type {
  SubmitFeedbackPayload,
  ListFeedbackParams,
  FeedbackStatus,
  FeedbackType
} from '@/api/domain/feedback/feedback.types'
import { feedbackKeys } from '@/api/infrastructure/query-keys/feedback.keys'
import { feedbackService } from '@/api/infrastructure/services/feedback.service'

import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'

/**
 * Submit bug report or feedback.
 * Invalidates the list on success so history page updates immediately.
 */
export function useSubmitFeedback() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: SubmitFeedbackPayload) => feedbackService.submit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.lists() })
      toast.success('Thank you for your feedback!')
    }
  })
}

/**
 * List the current user's feedback submissions.
 * Waits for bootstrap — needs auth.
 */
export function useMyFeedback(params?: ListFeedbackParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: feedbackKeys.list(params),
    queryFn: () => feedbackService.list(params),
    enabled: ready,
    placeholderData: previousData => previousData,
    staleTime: 60_000
  })
}

// My Feedback's table's own real query — replaces `FeedbackHistoryTab`'s
// former `useSelfFetchingServerTable` ad hoc `[tableKey, params]` key (Phase
// 2, fifth/sixth table; see TABLE_API_ARCHITECTURE_COMPARISON.md Part 3).
// Thin adapter over `useMyFeedback` (mapping `FetchParams` -> the backend's
// real `ListFeedbackParams`) — no new query-key factory needed, `useMyFeedback`
// was already correctly keyed through `feedbackKeys.list(params)`, the exact
// factory `useSubmitFeedback` already invalidates via `feedbackKeys.lists()`
// (array-prefix matching, the same mechanism already proven for `apiKeyKeys`/
// `tunnelKeys`). The table just wasn't using this hook yet — the compat
// shim's disjoint key meant a submitted feedback item never appeared in this
// table without a manual reload; confirmed by reading the code (no dialog in
// the submit path reloads the page) before converting, not assumed. See
// decision.md, 2026-09-16, "Phase 2: My Feedback converted".
//
// No sortBy in this table: the backend has none (`listMyFeedbackSchema` has
// only page/limit/status/type), and unlike Invitations, this endpoint has
// real server-side pagination (not a fetch-everything-then-slice shape) —
// client-side sorting would only ever sort the current page, silently wrong.
// All columns are non-sortable in FeedbackHistoryTab.tsx accordingly.
export function useMyFeedbackTableList(params: FetchParams) {
  const cleanParams = cleanTableParams(params)

  const listParams: ListFeedbackParams = cleanTableParams({
    page: cleanParams.page,
    limit: cleanParams.limit,
    status: cleanParams.filters?.status as FeedbackStatus | undefined,
    type: cleanParams.filters?.type as FeedbackType | undefined
  })

  return useMyFeedback(listParams)
}

/**
 * Get full detail for a single feedback item.
 */
export function useFeedbackDetail(feedbackId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: feedbackKeys.detail(feedbackId),
    queryFn: () => feedbackService.get(feedbackId),
    enabled: ready && !!feedbackId,
    staleTime: 5 * 60_000
  })
}
