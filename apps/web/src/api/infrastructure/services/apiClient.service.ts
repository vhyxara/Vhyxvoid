import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/apiClient.ts (the API validates with it).

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type KeyValue = { key: string; value: string; enabled: boolean }

export type ApiAuth =
  | { type: 'none' }
  | { type: 'inherit' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; name: string; value: string; in: 'header' | 'query' }
  | { type: 'hmac'; secret: string; algorithm: 'sha256' | 'sha1' | 'sha512'; encoding: 'hex' | 'base64'; header: string; prefix?: string; timestampHeader?: string }

export type MultipartField = KeyValue & { file?: { name: string; contentType: string; base64: string } }

export type ApiBody =
  | { type: 'none' }
  | { type: 'json'; text: string }
  | { type: 'graphql'; query: string; variables: string }
  | { type: 'form'; fields: KeyValue[] }
  | { type: 'multipart'; fields: MultipartField[] }
  | { type: 'raw'; text: string; contentType: string }
  | { type: 'file'; name: string; contentType: string; base64: string }

export type AssertionSource = 'status' | 'header' | 'json' | 'body' | 'time' | 'size'
export type AssertionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'notContains' | 'exists' | 'notExists' | 'matches' | 'type' | 'schema'

export type ApiAssertion = { id: string; enabled: boolean; source: AssertionSource; path?: string; op: AssertionOp; value?: string }
export type ApiCapture = { id: string; enabled: boolean; variable: string; source: 'json' | 'header' | 'status' | 'body'; path?: string }

export type ApiRequest = {
  id: string
  name: string
  method: ApiMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  auth: ApiAuth
  body: ApiBody
  assertions: ApiAssertion[]
  captures: ApiCapture[]
  folderId?: string | null
  description?: string
}

export type ApiVariable = KeyValue & { secret?: boolean }
export type EnvVariable = ApiVariable & { hasValue?: boolean; keep?: boolean }
export type ApiFolder = { id: string; name: string; parentId?: string | null }

export type CollectionSummary = { id: string; name: string; description: string; requestCount: number; folderCount: number; version: number; updatedAt: string }

export type Collection = CollectionSummary & {
  auth: ApiAuth
  variables: ApiVariable[]
  folders: ApiFolder[]
  requests: ApiRequest[]
  createdAt: string
  maxRequests?: number
  warnings?: string[]
  environmentsCreated?: string[]
}

export type Environment = { id: string; name: string; version: number; updatedAt: string; variables: EnvVariable[] }

export type ApiClientOverview = {
  enabled: boolean
  maxCollections: number
  maxRequests: number
  sendsPerMinute: number
  maxEnvironments: number
  snippetLanguages: Array<{ id: SnippetLanguage; label: string }>
  collections: CollectionSummary[]
  environments: Environment[]
}

export type SnippetLanguage = 'curl' | 'fetch' | 'axios' | 'python' | 'go'

export type Timings = { dns: number; connect: number; tls: number; firstByte: number; download: number; total: number }

export type ApiResponse = {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
  bodyEncoding: 'utf8' | 'base64'
  size: number
  truncated: boolean
  timings: Timings
  httpVersion?: string
  remoteAddress?: string
  redirects?: string[]
}

export type AssertionResult = { id: string; pass: boolean; label: string; message: string; actual?: string }
export type CaptureResult = { variable: string; ok: boolean; value?: string; message?: string }

export type SentRequest = { method: string; url: string; headers: Array<[string, string]>; body?: string }

export type SendResult =
  | { sent: false; problems: string[]; warnings: string[]; missing: string[]; request: SentRequest }
  | {
      sent: true
      response: ApiResponse | null
      error: { code: string; message: string } | null
      assertions: AssertionResult[]
      captures: CaptureResult[]
      warnings: string[]
      missing: string[]
      request: SentRequest
      historyId: string | null
    }

export type RunResult = {
  requestId: string
  name: string
  folder: string[]
  method: ApiMethod
  url: string
  status?: number
  timeMs?: number
  size?: number
  outcome: 'passed' | 'failed' | 'errored' | 'skipped'
  error?: string
  assertions: AssertionResult[]
  captures: CaptureResult[]
  responsePreview?: string
}

export type RunReport = {
  collection: string
  environment?: string
  startedAt: string
  durationMs: number
  total: number
  passed: number
  failed: number
  errored: number
  skipped: number
  assertions: { passed: number; failed: number }
  results: RunResult[]
}

export type RunSummary = {
  id: string
  collectionId: string
  environmentName: string | null
  trigger: string
  total: number
  passed: number
  failed: number
  errored: number
  skipped: number
  assertionsPassed: number
  assertionsFailed: number
  durationMs: number
  createdAt: string
}

export type HistoryItem = { id: string; method: string; url: string; status: number | null; durationMs: number | null; size: number | null; error: string | null; createdAt: string }

export type ParsedDocument = { format: string; collection: { name: string; variables: ApiVariable[]; folders: ApiFolder[]; requests: ApiRequest[]; auth: ApiAuth }; warnings: string[] }

/** Unsaved editor state the API applies (instead of the saved collection's). */
export type SendContext = { collectionId?: string; collection?: { variables?: ApiVariable[]; auth?: ApiAuth }; environmentId?: string | null; runtime?: Record<string, string> }

const base = (accountId: string) => `/api-client/${encodeURIComponent(accountId)}`

export const apiClientService = {
  overview: (accountId: string) => httpClient<ApiClientOverview>({ url: base(accountId), method: 'GET' }),
  createCollection: (accountId: string, data: { name?: string; description?: string; document?: string; mockId?: string }) =>
    httpClient<Collection>({ url: `${base(accountId)}/collections`, method: 'POST', data }),
  collection: (accountId: string, id: string) => httpClient<Collection>({ url: `${base(accountId)}/collections/${id}`, method: 'GET' }),
  saveCollection: (accountId: string, id: string, data: Partial<Pick<Collection, 'name' | 'description' | 'auth' | 'variables' | 'folders' | 'requests'>> & { expectedVersion?: number }) =>
    httpClient<Collection>({ url: `${base(accountId)}/collections/${id}`, method: 'PUT', data }),
  removeCollection: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${base(accountId)}/collections/${id}`, method: 'DELETE' }),
  run: (accountId: string, id: string, data: { environmentId?: string | null; folderId?: string | null; requestIds?: string[]; bail?: boolean; runtime?: Record<string, string> }) =>
    httpClient<{ id: string; createdAt: string; rateLimited: boolean; report: RunReport }>({ url: `${base(accountId)}/collections/${id}/run`, method: 'POST', data, timeoutMs: 150_000 }),
  runs: (accountId: string, id: string) => httpClient<{ runs: RunSummary[] }>({ url: `${base(accountId)}/collections/${id}/runs`, method: 'GET' }),
  runDetail: (accountId: string, runId: string) => httpClient<RunSummary & { report: RunReport }>({ url: `${base(accountId)}/runs/${runId}`, method: 'GET' }),
  createEnvironment: (accountId: string, data: { name: string; variables: EnvVariable[] }) => httpClient<Environment>({ url: `${base(accountId)}/environments`, method: 'POST', data }),
  saveEnvironment: (accountId: string, id: string, data: { name?: string; variables?: EnvVariable[]; expectedVersion?: number }) =>
    httpClient<Environment>({ url: `${base(accountId)}/environments/${id}`, method: 'PUT', data }),
  removeEnvironment: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${base(accountId)}/environments/${id}`, method: 'DELETE' }),
  parse: (accountId: string, document: string) => httpClient<ParsedDocument>({ url: `${base(accountId)}/parse`, method: 'POST', data: { document } }),
  send: (accountId: string, data: SendContext & { request: ApiRequest; followRedirects?: boolean; timeoutMs?: number; noHistory?: boolean }) =>
    httpClient<SendResult>({ url: `${base(accountId)}/send`, method: 'POST', data, timeoutMs: 150_000 }),
  snippet: (accountId: string, data: SendContext & { request: ApiRequest; lang: SnippetLanguage }) =>
    httpClient<{ lang: SnippetLanguage; code: string | null; problems: string[] }>({ url: `${base(accountId)}/snippet`, method: 'POST', data }),
  history: (accountId: string) => httpClient<{ items: HistoryItem[] }>({ url: `${base(accountId)}/history`, method: 'GET' }),
  historyItem: (accountId: string, id: string) =>
    httpClient<HistoryItem & { request: ApiRequest; response: ApiResponse | null }>({ url: `${base(accountId)}/history/${id}`, method: 'GET' }),
  clearHistory: (accountId: string) => httpClient<{ deleted: number }>({ url: `${base(accountId)}/history`, method: 'DELETE' }),

  /** The export is a file, not the JSON envelope, so it is fetched directly with the same token. */
  exportFile: async (accountId: string, id: string, format: 'vhyxvoid' | 'postman', environmentId?: string): Promise<{ blob: Blob; name: string }> => {
    const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
    const token = getAccessToken()
    const q = new URLSearchParams({ format, ...(environmentId ? { environmentId } : {}) })
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}${base(accountId)}/collections/${id}/export?${q}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include'
    })

    if (!res.ok) throw new Error(`Export failed (${res.status})`)
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `collection.${format}.json`

    return { blob: await res.blob(), name }
  }
}
