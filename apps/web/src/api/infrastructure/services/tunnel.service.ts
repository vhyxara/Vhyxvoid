import type { UsageAnalyticsResult, UsageSummary } from '@/api/domain/key-management/types/api-key.types'
import type {
  ActiveTunnelsResult,
  TunnelHistoryParams,
  TunnelSession,
  TunnelRequestsParams,
  TunnelRequest,
  TunnelUsageParams,
  TunnelUsageResult
} from '@/api/domain/key-management/types/tunnel.types'
import type { PaginatedResponse } from '@/api/types/pagination'
import { httpClient } from '@/api/wrapper/http'
import { buildQuery } from '@/utils/utility'
import { TUNNEL_ENDPOINTS } from '../endpoints/account.endpoints'

const u = (template: string, p: Record<string, string>) =>
  Object.entries(p).reduce((acc, [k, v]) => acc.replace(`:${k}`, v), template)

export const tunnelService = {
  getActive: (accountId: string): Promise<ActiveTunnelsResult> =>
    httpClient({ url: u(TUNNEL_ENDPOINTS.ACTIVE, { accountId }), method: 'GET' }),

  getHistory: (
    accountId: string,
    params?: TunnelHistoryParams
  ): Promise<PaginatedResponse<TunnelSession, { accountId: string }>> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({ url: `${u(TUNNEL_ENDPOINTS.HISTORY, { accountId })}${query}`, method: 'GET' })
  },

  getRequests: (
    accountId: string,
    agentId: string,
    params?: TunnelRequestsParams
  ): Promise<PaginatedResponse<TunnelRequest, { accountId: string; agentId: string }>> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({ url: `${u(TUNNEL_ENDPOINTS.REQUESTS, { accountId, agentId })}${query}`, method: 'GET' })
  },

  getUsage: (accountId: string, params?: TunnelUsageParams): Promise<TunnelUsageResult> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({ url: `${u(TUNNEL_ENDPOINTS.USAGE, { accountId })}${query}`, method: 'GET' })
  },

  getAnalytics: (
    accountId: string,
    params?: {
      range?: '24h' | '7d' | '30d' | '90d'
      keyId?: string
      metric?: 'requests' | 'bandwidth_bytes' | 'tunnel_minutes'
    }
  ): Promise<UsageAnalyticsResult> => {
    const query = params ? `?${buildQuery(params).toString()}` : ''

    return httpClient({ url: `${u(TUNNEL_ENDPOINTS.ANALYTICS, { accountId })}${query}`, method: 'GET' })
  },

  getUsageSummary: (accountId: string): Promise<UsageSummary> =>
    httpClient({ url: u(TUNNEL_ENDPOINTS.USAGE_SUMMARY, { accountId }), method: 'GET' })
}
