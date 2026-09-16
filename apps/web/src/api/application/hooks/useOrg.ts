// ── Queries ───────────────────────────────────────────────────────────────

import { useMemo } from 'react'

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

import { meKeys } from '@/api/infrastructure/query-keys/account.keys'

import { orgService } from '@/api/infrastructure/services/org.service'

import type { RenameOrgPayload, UpdateProfilePayload, CreateOrgPayload } from '@/api/domain/identity/types/org.types'
import type { Invitation } from '@/api/domain/identity/types/member.types'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { memberService } from '@/api/infrastructure/services/member.service'
import { useRouter } from '@/i18n/navigation'
import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'
import type { PaginatedResponse } from '@/api/types/pagination'

// ── Mutations ─────────────────────────────────────────────────────────────

export function useCreateOrg() {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: (data: CreateOrgPayload) => orgService.createOrg(data),

    onSuccess: res => {
      // Refresh the accounts list so the new org appears immediately.
      // meKeys.detail() is the real, live cache entry useMe/useMyAccounts/
      // useMyAccountsTableList all read from — accountKeys.all (['accounts'])
      // was a dead invalidation target with zero real readers, found and
      // fixed 2026-09-16; see decision.md, "Phase 2: My Organizations —
      // accountKeys.all invalidation was a dead target, fixed".
      queryClient.invalidateQueries({ queryKey: meKeys.detail() })

      // Navigate straight into the new org's members page
      router.push(`/organizations/${res.organizationId}/members`)
    }
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const { accessToken } = useAuthStore()

  return useMutation({
    mutationFn: (data: UpdateProfilePayload) => orgService.updateProfile(data),
    onSuccess: res => {
      // Update display name in Zustand immediately
      useAuthStore.getState().setTokens({
        accessToken: accessToken!,
        expiresIn: 0,
        user: {
          id: res.id,
          email: res.email,
          firstName: res.firstName,
          lastName: res.lastName
        }
      })

      // Refresh me query so accounts list stays in sync
      queryClient.invalidateQueries({ queryKey: meKeys.detail() })
    }
  })
}

// ── Organization ──────────────────────────────────────────────────────────

export function useOrgDetail(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: ['org', accountId],
    queryFn: () => orgService.getOrgDetail(accountId),
    enabled: ready && !!accountId
  })
}

// export function useCreateOrg() {
//   const queryClient = useQueryClient()
//   const router = useRouter()

//   return useMutation({
//     mutationFn: (data: CreateOrgPayload) => orgService.createOrg(data),
//     onSuccess: res => {
//       queryClient.invalidateQueries({ queryKey: accountKeys.all })
//       router.push(`/organizations/${res.organizationId}/members`)
//     }
//   })
// }

export function useRenameOrg(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: RenameOrgPayload) => orgService.renameOrg(accountId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', accountId] })
      queryClient.invalidateQueries({ queryKey: meKeys.detail() })
    }
  })
}

// ── Invitations ───────────────────────────────────────────────────────────

export function useInvitations(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: ['invitations', accountId],
    queryFn: () => memberService.getInvitations(accountId),
    enabled: ready && !!accountId
  })
}

function compareInvitations(a: Invitation, b: Invitation, sortBy: string, dir: 1 | -1): number {
  switch (sortBy) {
    case 'roleLevel':
      return dir * (a.roleLevel - b.roleLevel)
    case 'status':
      return dir * a.status.localeCompare(b.status)
    case 'expiresAt':
      return dir * (new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())
    case 'email':
    default:
      return dir * a.email.localeCompare(b.email)
  }
}

// The Invitations table's own real "query" — client-side, since the
// backend's GET .../invitations endpoint (apps/api's account.routes.ts,
// listInvitationsQuerySchema) accepts only an optional `status` filter, not
// page/limit/search/sortBy — it's a fixed `orderBy: createdAt desc, take:
// 100` server-side (confirmed by reading the route directly, not assumed).
// Wraps the SAME useInvitations(accountId) query (key ['invitations',
// accountId]) that useCancelInvitation already invalidates — an *exact* key
// match, not a prefix/subset one like Members'/API Keys', since the
// underlying fetch itself has no separate params dimension to begin with.
// Search/sort/pagination all happen here, client-side, over the single
// fetched batch. See decision.md, 2026-09-15, "Phase 2: Invitations
// converted to props-based table pattern".
export function useInvitationsTableList(accountId: string, params: FetchParams) {
  const query = useInvitations(accountId)
  const cleanParams = cleanTableParams(params)

  const data = useMemo<PaginatedResponse<Invitation> | undefined>(() => {
    if (!query.data) return undefined

    const search = cleanParams.search?.toLowerCase()

    const filtered = search
      ? query.data.invitations.filter(i => i.email.toLowerCase().includes(search))
      : query.data.invitations

    const sorted = cleanParams.sortBy
      ? [...filtered].sort((a, b) =>
          compareInvitations(a, b, cleanParams.sortBy as string, cleanParams.sortOrder === 'asc' ? 1 : -1)
        )
      : filtered

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
  }, [query.data, cleanParams.search, cleanParams.sortBy, cleanParams.sortOrder, cleanParams.page, cleanParams.limit])

  return { data, isLoading: query.isLoading, error: query.error }
}

export function useCancelInvitation(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (invitationId: string) => memberService.cancelInvitation(accountId, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations', accountId] })
    }
  })
}
