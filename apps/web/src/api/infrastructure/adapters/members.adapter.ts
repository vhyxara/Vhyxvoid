import type { Member, MembersListResponse } from '@/api/domain/identity/types/member.types'
import type { PaginatedResponse } from '@/api/types/pagination'

// Adapts the current flat response → PaginatedResponse for GenericServerTable.
// When backend switches to tableResponse, replace this with a passthrough.
export function adaptMembersResponse(
  res: MembersListResponse,
  params: { page: number; limit: number; search?: string }
): PaginatedResponse<Member> {
  return res
}

// When backend switches to tableResponse — swap to this:
// export function adaptMembersResponse(res: PaginatedResponse<Member>): PaginatedResponse<Member> {
//   return res
// }
