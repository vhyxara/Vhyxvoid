import type { FetchParams } from '@/libs/table/GenericServerTable'
import type { AdminRoleSummary } from '@/api/domain/admin-roles/admin-role.types'

/**
 * GET /admin/identity/roles has ZERO real query params (confirmed by
 * reading admin.dto.ts directly -- no listRolesSchema exists at all,
 * isActive: true is hardcoded server-side). Unlike Users (one real server
 * param, `status`), there's no server-side dimension to split out here --
 * this is a pure client-side search/sort/pagination over the full fetched
 * batch, closer to the Invitations precedent than to Users' hybrid shape.
 * See internal-tools/admin-frontend/decision.md, Screen 4 entry.
 */
function compareAdminRoles(a: AdminRoleSummary, b: AdminRoleSummary, sortBy: string, dir: 1 | -1): number {
  switch (sortBy) {
    case 'isSystem':
      return dir * (Number(a.isSystem) - Number(b.isSystem))
    case 'name':
    default:
      return dir * a.name.localeCompare(b.name)
  }
}

export function paginateAdminRoles(
  items: AdminRoleSummary[],
  params: Pick<FetchParams, 'search' | 'sortBy' | 'sortOrder' | 'page' | 'limit'>
): { items: AdminRoleSummary[]; total: number } {
  const search = params.search?.toLowerCase()
  const filtered = search
    ? items.filter(
        r => r.name.toLowerCase().includes(search) || (r.description ?? '').toLowerCase().includes(search)
      )
    : items

  const sorted = params.sortBy
    ? [...filtered].sort((a, b) => compareAdminRoles(a, b, params.sortBy as string, params.sortOrder === 'asc' ? 1 : -1))
    : filtered

  const page = params.page ?? 1
  const limit = params.limit ?? 10
  const start = (page - 1) * limit

  return { items: sorted.slice(start, start + limit), total: sorted.length }
}
