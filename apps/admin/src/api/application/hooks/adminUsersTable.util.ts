import type { FetchParams } from '@/libs/table/GenericServerTable'
import type { AdminUserSummary } from '@/api/domain/admin-users/admin-user.types'

export function parseStatusFilter(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false

  return undefined
}

function compareAdminUsers(a: AdminUserSummary, b: AdminUserSummary, sortBy: string, dir: 1 | -1): number {
  switch (sortBy) {
    case 'status':
      return dir * (Number(a.status) - Number(b.status))
    case 'lastLoginAt': {
      const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0
      const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0

      return dir * (aTime - bTime)
    }
    case 'fullName':
      return dir * a.fullName.localeCompare(b.fullName)
    case 'email':
    default:
      return dir * a.email.localeCompare(b.email)
  }
}

/**
 * The client-side search/sort/pagination GET /admin/identity/users itself
 * doesn't support (confirmed by reading listAdminsSchema directly -- its
 * only real param is `status`, handled separately as a genuine server
 * refetch, see useAdminUsers.ts). Extracted as a pure function (no React
 * Query involved) so it has its own direct, fast unit tests instead of
 * needing a QueryClientProvider + renderHook just to exercise a data
 * transform -- see adminUsersTable.util.test.ts.
 */
export function paginateAdminUsers(
  items: AdminUserSummary[],
  params: Pick<FetchParams, 'search' | 'sortBy' | 'sortOrder' | 'page' | 'limit'>
): { items: AdminUserSummary[]; total: number } {
  const search = params.search?.toLowerCase()

  const filtered = search
    ? items.filter(u => u.email.toLowerCase().includes(search) || u.fullName.toLowerCase().includes(search))
    : items

  const sorted = params.sortBy
    ? [...filtered].sort((a, b) => compareAdminUsers(a, b, params.sortBy as string, params.sortOrder === 'asc' ? 1 : -1))
    : filtered

  const page = params.page ?? 1
  const limit = params.limit ?? 10
  const start = (page - 1) * limit

  return {
    items: sorted.slice(start, start + limit),
    total: sorted.length
  }
}
