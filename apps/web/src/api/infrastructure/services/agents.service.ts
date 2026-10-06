import { httpClient } from '@/api/wrapper/http'

export type AgentVersionStatus = 'current' | 'outdated' | 'unsupported' | 'unknown'
export type AgentHealth = 'healthy' | 'lagging' | 'unresponsive'

export type FleetAgent = {
  agentId: string
  label: string
  url: string | null
  version: string | null
  versionStatus: AgentVersionStatus
  health: AgentHealth
  connectedAt: string
  uptimeSeconds: number
  lastSeenAt: string
  missedPings: number
  inFlight: number
  capabilities: string[]
  ip: string | null
  key: { id: string; keyId: string; name: string; environment: string; expiresAt: string | null; expiresSoon: boolean } | null
}

export type RecentSession = {
  agentId: string
  label: string
  status: 'DISCONNECTED' | 'EVICTED'
  connectedAt: string
  disconnectedAt: string | null
  durationSeconds: number | null
  version: string | null
  key: { name: string; keyId: string } | null
}

export type AgentFleet = {
  hubReachable: boolean
  canManage: boolean
  recommendedVersion: string | null
  minimumVersion: string | null
  summary: { connected: number; outdated: number; unhealthy: number; busy: number }
  agents: FleetAgent[]
  recent: RecentSession[]
}

const base = (accountId: string) => `/agents/${encodeURIComponent(accountId)}`

export const agentsService = {
  fleet: (accountId: string) => httpClient<AgentFleet>({ url: base(accountId), method: 'GET' }),
  stop: (accountId: string, agentId: string) => httpClient<{ agentId: string; label: string }>({ url: `${base(accountId)}/${encodeURIComponent(agentId)}/disconnect`, method: 'POST' })
}
