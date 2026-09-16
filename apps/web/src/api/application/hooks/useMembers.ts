// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

import type {
  InviteMemberPayload,
  ChangeMemberRolePayload,
  TransferOwnershipPayload,
  AcceptInvitationPayload,
  MembersListResponse
} from '@/api/domain/identity/types/member.types'

import { memberKeys, meKeys } from '@/api/infrastructure/query-keys/account.keys'

import { memberService } from '@/api/infrastructure/services/member.service'
import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'

// Returns full response — viewer context + members[]
export function useMembersData(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: memberKeys.list({ accountId }),
    queryFn: () => memberService.getMembers(accountId),
    enabled: ready && !!accountId
  })
}

export function useMembersList(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: memberKeys.list({ accountId }),
    queryFn: () => memberService.getMembers(accountId),
    enabled: ready && !!accountId,

    // Flatten to Member[] for permission checks; callers that need meta use the raw query
    select: (data: MembersListResponse) => data.items
  })
}

// The Members table's own real query — replaces GenericServerTable's former
// internal `useQuery` keyed by an ad hoc `[tableKey, params]` string (see
// TABLE_API_ARCHITECTURE_COMPARISON.md Part 3's Phase 2). Keyed through
// `memberKeys.list({accountId, ...params})`, which React Query's default
// partial-key matching means every mutation below already invalidates via
// its plain `memberKeys.list({accountId})` call — no separate ad hoc
// invalidate needed for this table anymore. See decision.md, 2026-09-15,
// "Phase 2 pilot: Members converted to props-based table pattern" for the
// live verification that this is actually true, not just a theoretical claim.
export function useMembersTableList(accountId: string, params: FetchParams) {
  const ready = useBootstrapReady()
  const cleanParams = cleanTableParams(params)

  return useQuery({
    queryKey: memberKeys.list({ accountId, ...cleanParams }),
    queryFn: () => memberService.getMembers(accountId, cleanParams),
    enabled: ready && !!accountId,
    placeholderData: previousData => previousData,
    staleTime: 5000
  })
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useInviteMember(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: InviteMemberPayload) => memberService.inviteMember(accountId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId }) })
      queryClient.invalidateQueries({ queryKey: ['invitations', accountId] })
    }
  })
}

export function useChangeMemberRole(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: ChangeMemberRolePayload }) => {
      if (!accountId) return Promise.reject(new Error('accountId is required'))

      return memberService.changeMemberRole(accountId, userId, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId }) })
    }
  })
}

export function useRemoveMember(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (targetUserId: string) => memberService.removeMember(accountId, targetUserId),

    // Optimistic update — remove from every cached page of this account's list
    onMutate: async targetUserId => {
      await queryClient.cancelQueries({ queryKey: memberKeys.lists() })

      // Snapshot all matching list queries for rollback
      const previousData = queryClient.getQueriesData<MembersListResponse>({
        queryKey: memberKeys.lists()
      })

      queryClient.setQueriesData<MembersListResponse>({ queryKey: memberKeys.lists() }, old => {
        if (!old) return old

        return {
          ...old,
          items: old.items.filter(m => m.userId !== targetUserId),
          meta: { ...old.meta, total: old.meta.total - 1 }
        }
      })

      return { previousData }
    },

    onError: (_err, _userId, context) => {
      // Restore all snapshots on failure
      context?.previousData.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data)
      })
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.lists() })
    }
  })
}

export function useTransferOwnership(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: TransferOwnershipPayload) => memberService.transferOwnership(accountId, data),
    onSuccess: () => {
      // Both members' roles changed — full refetch
      queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId }) })

      // Caller's own roleLevel changed to ADMIN — meKeys.detail() is the real
      // cache entry useMe/useMyAccounts/useMyAccountsTableList read from;
      // accountKeys.all was a dead invalidation target, fixed 2026-09-16.
      // See decision.md, "Phase 2: My Organizations — accountKeys.all
      // invalidation was a dead target, fixed".
      queryClient.invalidateQueries({ queryKey: meKeys.detail() })
    }
  })
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: AcceptInvitationPayload) => memberService.acceptInvitation(data),
    onSuccess: () => {
      // User now belongs to a new account
      queryClient.invalidateQueries({ queryKey: meKeys.detail() })
    }
  })
}

// later choose between current and this
// export function useRemoveMember(accountId: string) {
//   const queryClient = useQueryClient()
//   return useMutation({
//     mutationFn: (targetUserId: string) => memberService.removeMember(accountId, targetUserId),
//     onMutate: async targetUserId => {
//       await queryClient.cancelQueries({ queryKey: memberKeys.list({ accountId }) })
//       const previous = queryClient.getQueryData(memberKeys.list({ accountId }))
//       // Optimistic remove from members array inside the full response
//       queryClient.setQueryData(memberKeys.list({ accountId }), (old: any) =>
//         old
//           ? {
//               ...old,
//               members: old.members.filter((m: Member) => m.userId !== targetUserId),
//               totalCount: (old.totalCount ?? 1) - 1
//             }
//           : old
//       )
//       return { previous }
//     },
//     onError: (_err, _id, context) => {
//       if (context?.previous) {
//         queryClient.setQueryData(memberKeys.list({ accountId }), context.previous)
//       }
//     },
//     onSettled: () => {
//       queryClient.invalidateQueries({ queryKey: memberKeys.list({ accountId }) })
//     }
//   })
// }
