import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import { adminFeedbackKeys } from '@/api/infrastructure/query-keys/admin-feedback.keys'
import { adminFeedbackService } from '@/api/infrastructure/admin-feedback.service'
import type { UpdateFeedbackDTO } from '@/api/domain/admin-feedback/admin-feedback.types'

// Feedback's own real query -- GET /admin/feedback genuinely matches
// GenericServerTable's full server-driven shape (real page/limit/total,
// three combinable filters), confirmed via curl. The one screen in this
// app that doesn't need a client-side or over-fetch adaptation -- same
// props-based pattern as apps/web's Members/API Keys tables (see
// internal-tools/user-frontend/decision.md's Phase 2 entry).
export function useAdminFeedbackTableList(params: FetchParams) {
  const cleanParams = cleanTableParams(params)

  return useQuery({
    queryKey: adminFeedbackKeys.list(cleanParams),
    queryFn: () => adminFeedbackService.list(cleanParams),
    placeholderData: previousData => previousData
  })
}

export function useAdminFeedbackDetail(id: string) {
  return useQuery({
    queryKey: adminFeedbackKeys.detail(id),
    queryFn: () => adminFeedbackService.get(id),
    enabled: !!id
  })
}

export function useUpdateFeedback(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateFeedbackDTO) => adminFeedbackService.update(id, data),
    onSuccess: () => {
      // The PATCH response omits adminNotes -- refetch the detail query
      // rather than trust the mutation response to reflect it. The list's
      // status/priority columns and the counts badge also need a refetch.
      queryClient.invalidateQueries({ queryKey: adminFeedbackKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: adminFeedbackKeys.lists() })
    }
  })
}
