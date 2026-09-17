import type { FetchParams } from '@/libs/table/GenericServerTable'
import type { AdminAbilitySummary } from '@/api/domain/admin-abilities/admin-ability.types'

/**
 * GET /admin/identity/abilities has ZERO real query params (confirmed by
 * reading admin.dto.ts and admin.routes.ts directly -- no
 * listAbilitiesSchema exists, isActive: true is hardcoded server-side) --
 * same shape as Roles, not Users' one-real-param hybrid. Pure client-side
 * search/sort/pagination over the full fetched batch.
 */
function compareAdminAbilities(a: AdminAbilitySummary, b: AdminAbilitySummary, sortBy: string, dir: 1 | -1): number {
  switch (sortBy) {
    case 'category':
      return dir * a.category.localeCompare(b.category)
    case 'isSystem':
      return dir * (Number(a.isSystem) - Number(b.isSystem))
    case 'action':
    default:
      return dir * a.action.localeCompare(b.action)
  }
}

export function paginateAdminAbilities(
  items: AdminAbilitySummary[],
  params: Pick<FetchParams, 'search' | 'sortBy' | 'sortOrder' | 'page' | 'limit'>
): { items: AdminAbilitySummary[]; total: number } {
  const search = params.search?.toLowerCase()
  const filtered = search
    ? items.filter(
        a =>
          a.action.toLowerCase().includes(search) ||
          a.category.toLowerCase().includes(search) ||
          (a.description ?? '').toLowerCase().includes(search)
      )
    : items

  const sorted = params.sortBy
    ? [...filtered].sort((a, b) =>
        compareAdminAbilities(a, b, params.sortBy as string, params.sortOrder === 'asc' ? 1 : -1)
      )
    : filtered

  const page = params.page ?? 1
  const limit = params.limit ?? 10
  const start = (page - 1) * limit

  return { items: sorted.slice(start, start + limit), total: sorted.length }
}
