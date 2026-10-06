import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/mockApi.ts (the API validates with it).

export type MockMethod = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type MockMode = 'ALWAYS' | 'OFFLINE'
export type MockRuleSource = 'query' | 'header' | 'param' | 'cookie' | 'body' | 'method' | 'path'
export type MockRuleOp = 'equals' | 'not_equals' | 'contains' | 'exists' | 'not_exists' | 'regex'

export type MockRule = { source: MockRuleSource; key?: string; op: MockRuleOp; value?: string }

export type MockResponse = {
  id: string
  name?: string
  status: number
  headers?: Record<string, string>
  body?: string
  templating?: boolean
  latencyMs?: number
  rules?: MockRule[]
  rulesMatch?: 'all' | 'any'
  isDefault?: boolean
}

export type MockEndpoint = {
  id: string
  name?: string
  enabled: boolean
  method: MockMethod
  path: string
  selection?: 'rules' | 'sequential' | 'random'
  responses: MockResponse[]
}

export type MockSummary = {
  id: string
  label: string
  name: string
  description: string
  enabled: boolean
  mode: MockMode
  cors: boolean
  latencyMs: number
  endpointCount: number
  version: number
  updatedAt: string
  url: string | null
}

export type MockApi = MockSummary & {
  endpoints: MockEndpoint[]
  createdAt: string
  canManage?: boolean
  maxEndpoints?: number
  enabledOnPlatform?: boolean
}

export type MocksOverview = {
  enabled: boolean
  maxMocks: number
  maxEndpoints: number
  canManage: boolean
  templates: Array<{ key: string; name: string; description: string }>
  mocks: MockSummary[]
}

export type MockSave = Partial<Pick<MockApi, 'label' | 'name' | 'description' | 'enabled' | 'mode' | 'cors' | 'latencyMs' | 'endpoints'>> & { expectedVersion?: number }

export type MockTryAnswer =
  | { matched: false }
  | { matched: true; endpointId: string; responseId: string; status: number; headers: Record<string, string>; body: string; latencyMs: number }

const base = (accountId: string) => `/mocks/${encodeURIComponent(accountId)}`

export const mocksService = {
  overview: (accountId: string) => httpClient<MocksOverview>({ url: base(accountId), method: 'GET' }),
  get: (accountId: string, id: string) => httpClient<MockApi>({ url: `${base(accountId)}/${id}`, method: 'GET' }),
  create: (accountId: string, data: { label: string; name: string; description?: string; template?: string; openapi?: string }) =>
    httpClient<MockApi>({ url: base(accountId), method: 'POST', data }),
  save: (accountId: string, id: string, data: MockSave) => httpClient<MockApi>({ url: `${base(accountId)}/${id}`, method: 'PUT', data }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${base(accountId)}/${id}`, method: 'DELETE' }),
  import: (accountId: string, id: string, openapi: string, replace: boolean) =>
    httpClient<{ mock: MockApi; added: number; skipped: number; warnings: string[] }>({ url: `${base(accountId)}/${id}/import`, method: 'POST', data: { openapi, replace } }),
  try: (accountId: string, id: string, data: { method: string; path: string; headers?: Record<string, string>; body?: string; definition?: Partial<MockApi> }) =>
    httpClient<MockTryAnswer>({ url: `${base(accountId)}/${id}/try`, method: 'POST', data }),

  /** The export is a file, not the JSON envelope, so it is fetched directly with the same token. */
  exportOpenApi: async (accountId: string, id: string, format: 'json' | 'yaml'): Promise<Blob> => {
    const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
    const token = getAccessToken()
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}${base(accountId)}/${id}/openapi?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include'
    })

    if (!res.ok) throw new Error(`Export failed (${res.status})`)

    return res.blob()
  }
}
