import type {
  AdminFeedbackDetail,
  AdminFeedbackListItem,
  AdminFeedbackUpdateResponse,
  FeedbackCounts,
  UpdateFeedbackDTO
} from '@/api/domain/admin-feedback/admin-feedback.types'
import type { PaginatedResponse } from '@/api/types/pagination'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { ADMIN_FEEDBACK_ENDPOINTS } from './admin-feedback.endpoints'
import { httpClient } from '@/api/wrapper/http'

// adminListFeedbackSchema (feedback.routes.ts): page/limit (real server
// pagination, confirmed via curl) + status/type/priority -- three
// independent, COMBINABLE filters (the repository ANDs whichever are
// present), unlike Audit Log's mutually-exclusive trio. NO search, NO
// sort of any kind -- confirmed by reading both the schema and
// PrismaFeedbackRepository directly (orderBy is hardcoded to
// `createdAt: 'desc'`, no sortBy param exists anywhere). `search`/
// `sortBy`/`sortOrder` from FetchParams are therefore deliberately never
// sent -- not omitted by oversight.
export function buildFeedbackQuery(params: FetchParams): string {
  const search = new URLSearchParams()

  search.set('page', String(params.page))
  search.set('limit', String(params.limit))

  const status = params.filters?.status
  const type = params.filters?.type
  const priority = params.filters?.priority

  if (status) search.set('status', status)
  if (type) search.set('type', type)
  if (priority) search.set('priority', priority)

  return search.toString()
}

export const adminFeedbackService = {
  list: (params: FetchParams) =>
    httpClient<PaginatedResponse<AdminFeedbackListItem, { counts: FeedbackCounts }>>({
      url: `${ADMIN_FEEDBACK_ENDPOINTS.LIST}?${buildFeedbackQuery(params)}`,
      method: 'GET'
    }),

  get: (id: string) =>
    httpClient<AdminFeedbackDetail>({
      url: ADMIN_FEEDBACK_ENDPOINTS.DETAIL(id),
      method: 'GET'
    }),

  // Real response is narrower than the full entity ({id, status, priority}
  // only, confirmed via curl) -- callers refetch the detail query rather
  // than trust this to reflect an updated adminNotes value.
  update: (id: string, data: UpdateFeedbackDTO) =>
    httpClient<AdminFeedbackUpdateResponse>({
      url: ADMIN_FEEDBACK_ENDPOINTS.UPDATE(id),
      method: 'PATCH',
      data
    })
}
