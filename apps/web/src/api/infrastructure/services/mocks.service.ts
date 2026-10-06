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

export type MockResource = {
  id: string
  name: string
  path: string
  enabled: boolean
  idField?: string
  seed: Array<Record<string, unknown>>
}

export type MockExportFormat = 'openapi' | 'openapi-json' | 'msw' | 'postman' | 'mockoon' | 'vhyxvoid'

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
  resourceCount?: number
  version: number
  updatedAt: string
  url: string | null
}

export type MockApi = MockSummary & {
  endpoints: MockEndpoint[]
  resources: MockResource[]
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

export type MockSave = Partial<Pick<MockApi, 'label' | 'name' | 'description' | 'enabled' | 'mode' | 'cors' | 'latencyMs' | 'endpoints' | 'resources'>> & { expectedVersion?: number }

export type MockImportResult = { mock: MockApi; format?: string; added: number; addedResources?: number; skipped: number; warnings: string[] }

export type MockTryAnswer =
  | { matched: false }
  | { matched: true; endpointId: string; responseId: string; status: number; headers: Record<string, string>; body: string; latencyMs: number }

const base = (accountId: string) => `/mocks/${encodeURIComponent(accountId)}`

export const mocksService = {
  overview: (accountId: string) => httpClient<MocksOverview>({ url: base(accountId), method: 'GET' }),
  get: (accountId: string, id: string) => httpClient<MockApi>({ url: `${base(accountId)}/${id}`, method: 'GET' }),
  create: (accountId: string, data: { label: string; name: string; description?: string; template?: string; document?: string }) =>
    httpClient<MockApi>({ url: base(accountId), method: 'POST', data }),
  save: (accountId: string, id: string, data: MockSave) => httpClient<MockApi>({ url: `${base(accountId)}/${id}`, method: 'PUT', data }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${base(accountId)}/${id}`, method: 'DELETE' }),
  import: (accountId: string, id: string, document: string, replace: boolean) =>
    httpClient<MockImportResult>({ url: `${base(accountId)}/${id}/import`, method: 'POST', data: { document, replace } }),
  record: (accountId: string, id: string, label: string, ids: string[]) =>
    httpClient<MockImportResult>({ url: `${base(accountId)}/${id}/record`, method: 'POST', data: { label, ids } }),
  data: (accountId: string, id: string, resourceId: string) =>
    httpClient<{ resourceId: string; items: Array<Record<string, unknown>>; count: number }>({ url: `${base(accountId)}/${id}/data/${encodeURIComponent(resourceId)}`, method: 'GET' }),
  resetData: (accountId: string, id: string, resourceId: string) =>
    httpClient<{ resourceId: string }>({ url: `${base(accountId)}/${id}/data/${encodeURIComponent(resourceId)}`, method: 'DELETE' }),
  try: (accountId: string, id: string, data: { method: string; path: string; headers?: Record<string, string>; body?: string; definition?: Partial<MockApi> }) =>
    httpClient<MockTryAnswer>({ url: `${base(accountId)}/${id}/try`, method: 'POST', data }),

  /**
   * The export is a file, not the JSON envelope, so it is fetched directly with
   * the same token. Returns the file and the name the API suggests for it.
   */
  exportFile: async (accountId: string, id: string, format: MockExportFormat): Promise<{ blob: Blob; name: string }> => {
    const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
    const token = getAccessToken()
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}${base(accountId)}/${id}/export?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include'
    })

    if (!res.ok) throw new Error(`Export failed (${res.status})`)
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `mock.${format}`

    return { blob: await res.blob(), name }
  }
}
