export type ApiKeyEnvironment = 'DEV' | 'PROD'
export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED'
export type ApiScope = string

export type ApiKey = {
  id: string
  keyId: string
  name: string
  description: string | null
  environment: ApiKeyEnvironment
  status: ApiKeyStatus
  scopes: ApiScope[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  createdByUserId: string
}

export type ApiKeyWithSecret = {
  key: ApiKey
  secret: string
  notice: string
}

export type ApiKeyRotateResult = {
  secret: string
  graceEndsAt: string
  notice: string
}

export type UsageSeriesPoint = {
  timestamp: string
  value: number
}

export type UsageAnalyticsResult = {
  accountId: string
  scope: string
  keyId: string | null
  metric: 'requests' | 'bandwidth_bytes' | 'tunnel_minutes'
  range: '24h' | '7d' | '30d' | '90d'
  period: { start: string; end: string }
  summary: { total: number; peak: number; average: number }
  series: UsageSeriesPoint[]
}

export type UsageSummary = {
  accountId: string
  period: { start: string; end: string; label: string }
  stats: {
    totalRequests: number
    activeApiKeys: number
    activeTunnels: number
    totalMembers: number
  }
}

export type CreateApiKeyPayload = {
  name: string
  description?: string
  environment: ApiKeyEnvironment
  scopes: ApiScope[]
  expiresAt?: string
}

export type UpdateApiKeyPayload = {
  name?: string
  description?: string
  scopes?: ApiScope[]
}

export type RevokeApiKeyPayload = {
  reason?: string
}

export type ListApiKeysParams = {
  status?: ApiKeyStatus
  environment?: ApiKeyEnvironment
  page?: number
  limit?: number
  search?: string
  sortBy?: 'name' | 'createdAt' | 'lastUsedAt' | 'status' | 'environment'
  sortOrder?: 'asc' | 'desc'
}
