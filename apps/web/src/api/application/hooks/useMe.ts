// application/hooks/useMe.ts

import { useMemo } from 'react'

import { useQuery } from '@tanstack/react-query'

import { orgService } from '@/api/infrastructure/services/org.service'
import { meKeys } from '@/api/infrastructure/query-keys/account.keys'
import type { MeResponse, MyAccount } from '@/api/domain/identity/types/org.types'
import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import type { PaginatedResponse } from '@/api/types/pagination'

/**
 * Fetches the authenticated user's profile + accounts.
 * Single query — all dashboard components read from this shared cache.
 * staleTime 5min — profile data changes rarely.
 */
export function useMe() {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: meKeys.detail(),
    queryFn: orgService.getMe,
    enabled: ready, // Don't run until bootstrap (which checks for existing session) is done
    staleTime: 5 * 60 * 1000
  })
}

/**
 * Selector — components that only need the accounts list.
 * Shares the same cache entry as useMe() — no extra fetch.
 */
export function useMyAccounts() {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: meKeys.detail(),
    queryFn: orgService.getMe,
    enabled: ready,
    select: (data: MeResponse) => data.accounts,
    staleTime: 5 * 60 * 1000
  })
}

function compareMyAccounts(a: MyAccount, b: MyAccount, sortBy: string, dir: 1 | -1): number {
  switch (sortBy) {
    case 'roleLevel':
      return dir * (a.roleLevel - b.roleLevel)
    case 'joinedAt':
      return dir * (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())
    case 'accountName':
    default:
      return dir * (a.accountName ?? '').localeCompare(b.accountName ?? '')
  }
}

// My Organizations table's own real query — replaces MyAccountsTable.tsx's
// former `useSelfFetchingServerTable` ad hoc `[tableKey, params]` key (Phase
// 2, seventh table; see TABLE_API_ARCHITECTURE_COMPARISON.md Part 3). Wraps
// the *same* `useMyAccounts()` query (itself sharing `meKeys.detail()`'s
// cache entry with useMe/useMyProfile) and does search/roleLevel-filter/
// sort/pagination in a useMemo — like useInvitationsTableList, there's no
// separate parameterized cache entry, so the table's real query key is
// **exactly** meKeys.detail(), an exact match (not a prefix/subset one)
// with what useCreateOrg/useUpdateProfile/useRenameOrg/useTransferOwnership/
// useAcceptInvitation now correctly invalidate (previously they invalidated
// accountKeys.all, a dead key with zero real readers — see decision.md,
// 2026-09-16, "Phase 2: My Organizations — accountKeys.all invalidation was
// a dead target, fixed"). No backend pagination/sort/search exists for
// GET /account/me (confirmed by reading account.routes.ts's `/me` handler —
// it takes no query params at all and returns every account unconditionally),
// so — same shape as Invitations — this is all done client-side.
export function useMyAccountsTableList(params: FetchParams) {
  const query = useMyAccounts()
  const cleanParams = cleanTableParams(params)

  const data = useMemo<PaginatedResponse<MyAccount> | undefined>(() => {
    if (!query.data) return undefined

    const search = cleanParams.search?.toLowerCase()

    const filtered = search
      ? query.data.filter(
          a => a.accountId.toLowerCase().includes(search) || a.roleName.toLowerCase().includes(search)
        )
      : query.data

    const roleFilter = cleanParams.filters?.roleLevel
    const afterRole = roleFilter ? filtered.filter(a => String(a.roleLevel) === roleFilter) : filtered

    const sorted = cleanParams.sortBy
      ? [...afterRole].sort((a, b) =>
          compareMyAccounts(a, b, cleanParams.sortBy as string, cleanParams.sortOrder === 'asc' ? 1 : -1)
        )
      : afterRole

    const page = cleanParams.page ?? 1
    const limit = cleanParams.limit ?? 10
    const start = (page - 1) * limit

    return {
      success: true,
      message: 'ok',
      items: sorted.slice(start, start + limit),
      meta: {
        page,
        limit,
        total: sorted.length,
        totalPages: Math.ceil(sorted.length / limit) || 1
      }
    }
  }, [query.data, cleanParams.search, cleanParams.filters?.roleLevel, cleanParams.sortBy, cleanParams.sortOrder, cleanParams.page, cleanParams.limit])

  return { data, isLoading: query.isLoading, error: query.error }
}

/**
 * Selector — components that only need the user's profile fields.
 * Shares the same cache entry — no extra fetch.
 */
export function useMyProfile() {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: meKeys.detail(),
    queryFn: orgService.getMe,
    enabled: ready,
    select: (data: MeResponse) => ({
      id: data.id,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      isEmailVerified: data.isEmailVerified
    }),
    staleTime: 5 * 60 * 1000
  })
}
