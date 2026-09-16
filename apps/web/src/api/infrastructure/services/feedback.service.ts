import type {
  SubmitFeedbackPayload,
  SubmitFeedbackResult,
  ListFeedbackParams,
  FeedbackListItem,
  FeedbackDetail
} from '@/api/domain/feedback/feedback.types'
import type { PaginatedResponse } from '@/api/types/pagination'
import { httpClient } from '@/api/wrapper/http'
import { buildQuery } from '@/utils/utility'
import { FEEDBACK_ENDPOINTS } from '../endpoints/feedback.endpoints'

export const feedbackService = {
  /**
   * POST /feedback
   * Submit bug report or feedback. Auth required.
   * pageUrl is auto-captured here if not provided by caller.
   */
  submit: (data: SubmitFeedbackPayload): Promise<SubmitFeedbackResult> =>
    httpClient({
      url: FEEDBACK_ENDPOINTS.SUBMIT,
      method: 'POST',
      data: {
        ...data,

        // Auto-capture current page URL if not explicitly provided
        pageUrl: data.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : null),
        appVersion: data.appVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? null
      }
    }),

  /**
   * GET /feedback
   * List the authenticated user's own submissions. Paginated.
   */
  list: (params?: ListFeedbackParams): Promise<PaginatedResponse<FeedbackListItem>> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({
      url: `${FEEDBACK_ENDPOINTS.LIST}${query}`,
      method: 'GET'
    })
  },

  /**
   * GET /feedback/:feedbackId
   * Full detail for a single feedback item — users can only see their own.
   */
  get: (feedbackId: string): Promise<FeedbackDetail> =>
    httpClient({
      url: FEEDBACK_ENDPOINTS.GET.replace(':feedbackId', feedbackId),
      method: 'GET'
    })
}
