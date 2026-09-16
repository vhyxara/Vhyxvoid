export type TunnelStatus = 'CONNECTED' | 'DISCONNECTED' | 'EVICTED'

export type TunnelApiKey = {
  keyId: string
  name: string
  environment: string
}

export type ActiveTunnel = {
  agentId: string
  label: string
  status: TunnelStatus
  connectedAt: string
  hubInstanceId: string
  metadata: Record<string, unknown> | null
  apiKey: TunnelApiKey | null
}

export type ActiveTunnelsResult = {
  accountId: string
  activeSessions: ActiveTunnel[]
  activeCount: number
}

export type TunnelSession = {
  id: string
  agentId: string
  label: string
  status: TunnelStatus
  connectedAt: string
  disconnectedAt: string | null
  durationMs: number | null
  apiKey: TunnelApiKey | null
}

export type TunnelRequest = {
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number | null
  errorCode: string | null
  createdAt: string
}

export type TunnelHistoryParams = {
  page?: number
  limit?: number
  status?: 'CONNECTED' | 'DISCONNECTED' | 'EVICTED'
  search?: string
  sortBy?: 'connectedAt' | 'disconnectedAt' | 'label' | 'status'
  sortOrder?: 'asc' | 'desc'
}

export type TunnelRequestsParams = {
  page?: number
  limit?: number
  search?: string
  sortBy?: 'createdAt' | 'method' | 'path' | 'status' | 'durationMs'
  sortOrder?: 'asc' | 'desc'
}

export type TunnelUsageParams = {
  from?: string
  to?: string
}

export type TunnelHourlyStats = {
  hour: string
  count: number
  avgDurationMs: number | null
}

export type TunnelUsageResult = {
  accountId: string
  period: { from: string; to: string }
  hourly: TunnelHourlyStats[]
  totals: { requests: number; avgDurationMs: number | null }
}
