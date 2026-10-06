import { httpClient } from '@/api/wrapper/http'

export type TrafficRange = '1h' | '24h' | '7d'

export type TrafficPoint = { t: string; requests: number; errors4xx: number; errors5xx: number; avgMs: number | null }

export type TrafficTotals = { requests: number; errors4xx: number; errors5xx: number; avgMs: number | null; errorRate: number | null }

export type TunnelTraffic = {
  range: TrafficRange
  label: string | null
  from: string
  to: string
  bucketMinutes: number
  series: TrafficPoint[]
  totals: TrafficTotals
  top: Array<TrafficTotals & { label: string }>
}

export const trafficService = {
  get: (accountId: string, range: TrafficRange, label?: string | null) =>
    httpClient<TunnelTraffic>({
      url: `/traffic/${encodeURIComponent(accountId)}`,
      method: 'GET',
      params: { range, ...(label ? { label } : {}) }
    })
}
