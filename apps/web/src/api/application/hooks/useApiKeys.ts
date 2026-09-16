import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

import type {
  ListApiKeysParams,
  ApiKeyStatus,
  ApiKeyEnvironment,
  CreateApiKeyPayload,
  UpdateApiKeyPayload,
  RevokeApiKeyPayload
} from '@/api/domain/key-management/types/api-key.types'
import { apiKeyKeys } from '@/api/infrastructure/query-keys/api-key.keys'
import { apiKeyService } from '@/api/infrastructure/services/api-key.service'
import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'

export function useApiKeys(accountId: string, params?: ListApiKeysParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: apiKeyKeys.list(accountId, params),
    queryFn: () => apiKeyService.list(accountId, params),
    enabled: ready && !!accountId,
    staleTime: 30_000
  })
}

// The API Keys table's own real query — replaces GenericServerTable's former
// internal `useQuery` keyed by an ad hoc `[tableKey, params]` string (Phase 2
// pilot, following the pattern proven on Members' `useMembersTableList`; see
// TABLE_API_ARCHITECTURE_COMPARISON.md Part 3). `apiKeyKeys.list(accountId,
// params)` already accepted full query params before this change (unlike
// `memberKeys`, no generic-type widening was needed here) — keying the
// table's own query through it means every mutation hook's existing
// `invalidateQueries({queryKey: apiKeyKeys.lists(accountId)})` /
// `apiKeyKeys.all(accountId)` call already invalidates it too, via React
// Query's default array-prefix matching (a shorter filter key array matches
// any actual key that starts with the same elements — no need for the
// filter and actual key to have the same length, unlike the object-subset
// matching `memberKeys` relies on). See decision.md, 2026-09-15, "Phase 2:
// API Keys converted to props-based table pattern" for the live/automated
// verification that this is actually true.
export function useApiKeysTableList(accountId: string, params: FetchParams) {
  const ready = useBootstrapReady()
  const cleanParams = cleanTableParams(params)

  const listParams: ListApiKeysParams = cleanTableParams({
    page: cleanParams.page,
    limit: cleanParams.limit,
    search: cleanParams.search,
    sortBy: cleanParams.sortBy as ListApiKeysParams['sortBy'],
    sortOrder: cleanParams.sortOrder,
    status: cleanParams.filters?.status as ApiKeyStatus | undefined,
    environment: cleanParams.filters?.environment as ApiKeyEnvironment | undefined
  })

  return useQuery({
    queryKey: apiKeyKeys.list(accountId, listParams),
    queryFn: () => apiKeyService.list(accountId, listParams),
    enabled: ready && !!accountId,
    placeholderData: previousData => previousData,
    staleTime: 5000
  })
}

export function useApiKey(accountId: string, keyId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: apiKeyKeys.detail(accountId, keyId),
    queryFn: () => apiKeyService.get(accountId, keyId),
    enabled: ready && !!accountId && !!keyId
  })
}

export function useApiKeyUsage(accountId: string, params?: { keyId?: string; from?: string; to?: string }) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: apiKeyKeys.usage(accountId, params),
    queryFn: () => apiKeyService.getUsage(accountId, params),
    enabled: ready && !!accountId,
    staleTime: 60_000
  })
}

export function useCreateApiKey(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateApiKeyPayload) => apiKeyService.create(accountId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists(accountId) })
    }
  })
}

export function useUpdateApiKey(accountId: string, keyId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateApiKeyPayload) => apiKeyService.update(accountId, keyId, data),
    onSuccess: updated => {
      // Update detail cache immediately — no need to wait for refetch
      queryClient.setQueryData(apiKeyKeys.detail(accountId, keyId), updated)
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists(accountId) })
    }
  })
}

export function useRevokeApiKey(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ keyId, data }: { keyId: string; data?: RevokeApiKeyPayload }) =>
      apiKeyService.revoke(accountId, keyId, data),

    onMutate: async ({ keyId }) => {
      await queryClient.cancelQueries({ queryKey: apiKeyKeys.lists(accountId) })
      const previous = queryClient.getQueriesData({ queryKey: apiKeyKeys.lists(accountId) })

      // Optimistic: mark as REVOKED immediately in list cache
      queryClient.setQueriesData({ queryKey: apiKeyKeys.lists(accountId) }, (old: any) => {
        if (!old?.items) return old

        return {
          ...old,
          items: old.items.map((k: any) => (k.keyId === keyId ? { ...k, status: 'REVOKED' } : k))
        }
      })

      return { previous }
    },

    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists(accountId) })
    }
  })
}

export function useRotateApiKey(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiKeyService.rotate(accountId, id),
    onSuccess: () => {
      // Rotation creates a new secret — invalidate list so lastUsedAt etc refresh
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all(accountId) })
    }
  })
}
