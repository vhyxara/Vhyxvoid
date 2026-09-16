import { useQuery } from '@tanstack/react-query'

import type {
  TunnelHistoryParams,
  TunnelRequestsParams,
  TunnelUsageParams
} from '@/api/domain/key-management/types/tunnel.types'
import { tunnelKeys } from '@/api/infrastructure/query-keys/api-key.keys'
import { tunnelService } from '@/api/infrastructure/services/tunnel.service'
import { useBootstrapReady } from './useBootstrapSession'
import type { FetchParams } from '@/libs/table/GenericServerTable'
import { cleanTableParams } from '@/libs/table/tableUtility'

export function useActiveTunnels(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.active(accountId),
    queryFn: () => tunnelService.getActive(accountId),
    enabled: ready && !!accountId,

    // Active tunnels change frequently — refetch every 30s
    refetchInterval: 30_000,
    staleTime: 15_000
  })
}

export function useTunnelHistory(accountId: string, params?: TunnelHistoryParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.history(accountId, params),
    queryFn: () => tunnelService.getHistory(accountId, params),
    enabled: ready && !!accountId,
    staleTime: 30_000
  })
}

// Tunnels' history table's own real query — replaces
// `useSelfFetchingServerTable`'s ad hoc `[tableKey, params]` key (Phase 2,
// fourth table; see TABLE_API_ARCHITECTURE_COMPARISON.md Part 3). Keyed
// through `tunnelKeys.history(accountId, params)` — the same hand-written,
// array-prefix-based factory `useTunnelHistory` above already uses. Unlike
// Members/API Keys/Invitations, there is no point-fix to remove here and no
// invalidation-mechanism proof needed: this screen has zero mutations
// anywhere (confirmed by grep — no `useMutation` touches any tunnel hook or
// service), so the disjoint-query-key staleness bug this whole migration is
// about literally cannot occur on this table. See context.md item 34 and
// decision.md, 2026-09-16, "Phase 2: Tunnels converted".
export function useTunnelHistoryTableList(accountId: string, params: FetchParams) {
  const ready = useBootstrapReady()
  const cleanParams = cleanTableParams(params)

  const listParams: TunnelHistoryParams = cleanTableParams({
    page: cleanParams.page,
    limit: cleanParams.limit,
    search: cleanParams.search,
    sortBy: cleanParams.sortBy as TunnelHistoryParams['sortBy'],
    sortOrder: cleanParams.sortOrder,
    status: cleanParams.filters?.status as TunnelHistoryParams['status']
  })

  return useQuery({
    queryKey: tunnelKeys.history(accountId, listParams),
    queryFn: async () => {
      const result = await tunnelService.getHistory(accountId, listParams)

      // The backend's history endpoint response omits `id` entirely, even
      // though `TunnelSession`'s own type declares it as required (see the
      // pre-conversion `fetchHistory`'s identical comment in
      // TunnelsView.tsx / decision.md, 2026-09-10, "Step 5a"). agentId has
      // a DB-level unique constraint, so it's a safe substitute for row keys.
      return { ...result, items: result.items.map(item => ({ ...item, id: item.agentId })) }
    },
    enabled: ready && !!accountId,
    placeholderData: previousData => previousData,
    staleTime: 5000
  })
}

export function useTunnelRequests(accountId: string, agentId: string, params?: TunnelRequestsParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.requests(accountId, agentId, params),
    queryFn: () => tunnelService.getRequests(accountId, agentId, params),
    enabled: ready && !!accountId && !!agentId,
    staleTime: 15_000
  })
}

export function useTunnelUsage(accountId: string, params?: TunnelUsageParams) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.usage(accountId, params),
    queryFn: () => tunnelService.getUsage(accountId, params),
    enabled: ready && !!accountId,
    staleTime: 60_000
  })
}

export function useTunnelAnalytics(
  accountId: string,
  params?: {
    range?: '24h' | '7d' | '30d' | '90d'
    keyId?: string
    metric?: 'requests' | 'bandwidth_bytes' | 'tunnel_minutes'
  }
) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.analytics(accountId, params),
    queryFn: () => tunnelService.getAnalytics(accountId, params),
    enabled: ready && !!accountId,
    staleTime: 60_000
  })
}

export function useUsageSummary(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: tunnelKeys.summary(accountId),
    queryFn: () => tunnelService.getUsageSummary(accountId),
    enabled: ready && !!accountId,
    staleTime: 60_000
  })
}
