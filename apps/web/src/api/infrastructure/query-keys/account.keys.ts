import { createQueryKeys } from '@vhyx/api-kit'

import type { FetchParams } from '@/libs/table/GenericServerTable'

// memberKeys.list({ accountId }) — for GET /organizations/:accountId/members
// (plain viewer/permission-check reads), or
// memberKeys.list({ accountId, page, limit, ... }) — for the Members table's
// own paginated/sorted/filtered read (useMembersTableList). React Query's
// default `invalidateQueries` partial-key match means invalidating with just
// `{ accountId }` also matches every parameterized variant below it — see
// decision.md, 2026-09-15, "Phase 2 pilot".
export const memberKeys = createQueryKeys<{ accountId: string } & Partial<FetchParams>>('members')

// Dedicated key for the /account/me endpoint — never conflicts with list queries
export const meKeys = {
  all: ['me'] as const,
  detail: () => ['me', 'detail'] as const
}

// type MemberListParams = Partial<FetchParams> & { accountId: string }

// export const memberKeys = {
//   all: ['members'] as const,
//   lists: () => ['members', 'list'] as const,
//   list: (params: MemberListParams) => ['members', 'list', params] as const,
//   detail: (userId: string) => ['members', 'detail', userId] as const
// }
