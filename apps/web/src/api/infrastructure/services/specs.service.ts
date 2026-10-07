import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/apiSpec.ts and apps/api/src/modules/platform/specs.

export type SpecProblem = { path: string; message: string; severity: 'error' | 'warning' }
export type SpecChange = { severity: 'breaking' | 'warning' | 'info'; location: string; message: string }
export type ChangeCounts = { breaking: number; warning: number; info: number }
export type SnippetLang = 'curl' | 'fetch' | 'python' | 'go'

export type DocsMedia = { type: string; schema: unknown; example: unknown }
export type DocsParameter = {
  name: string
  in: string
  required: boolean
  deprecated: boolean
  description: string
  schema: unknown
  example: unknown
}

export type DocsOperation = {
  id: string
  method: string
  path: string
  summary: string
  description: string
  operationId: string
  deprecated: boolean
  tags: string[]
  parameters: DocsParameter[]
  requestBody: { required: boolean; description: string; contents: DocsMedia[] } | null
  responses: Array<{
    code: string
    description: string
    contents: DocsMedia[]
    headers: Array<{ name: string; description: string; schema: unknown }>
  }>
  security: string[][]
  samples: Partial<Record<SnippetLang, string>>
}

export type DocsModel = {
  title: string
  version: string
  description: string
  openapi: string
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string; description: string; operations: DocsOperation[] }>
  schemas: Array<{ name: string; description: string; schema: unknown }>
  securitySchemes: Array<{
    name: string
    type: string
    scheme: string
    in: string
    paramName: string
    description: string
    bearerFormat: string
  }>
  operationCount: number
}

export type Visibility = 'PRIVATE' | 'PUBLIC' | 'PASSWORD'

export type SpecVersionSummary = {
  id: string
  number: number
  version: string
  breaking: number
  notes: string
  createdAt: string
  publishedById: string | null
  counts?: ChangeCounts
}

export type SpecSharing = {
  visibility: Visibility
  hasPassword: boolean
  tryMockId: string | null
  publicUrl: string
  customDomain: string | null
  customDomainVerified: boolean
  customDomainUrl: string | null
}

export type SpecSummary = SpecSharing & {
  id: string
  name: string
  slug: string
  description: string
  version: number
  updatedAt: string
  createdAt: string
  latest: SpecVersionSummary | null
  unpublished: boolean
}

export type DnsRecords = {
  verification: { type: string; name: string; value: string }
  routing: { type: string; name: string; value: string } | null
} | null

export type Spec = SpecSummary & {
  draftText: string
  draftFormat: 'yaml' | 'json'
  problems: SpecProblem[]
  canManage?: boolean
  enabledOnPlatform?: boolean
  limits?: { protectedDocs: boolean; customDomains: boolean }
  domainRecords?: DnsRecords
}

export type SpecsOverview = {
  enabled: boolean
  limits: { maxSpecs: number; protectedDocs: boolean; customDomains: boolean }
  canManage: boolean
  workspace: string
  specs: SpecSummary[]
}

export type SpecPreview = {
  problems: SpecProblem[]
  converted: boolean
  doc: Record<string, unknown> | null
  model: DocsModel | null
  against: SpecVersionSummary | null
  changes: SpecChange[]
  counts: ChangeCounts
}

export type PublishResult = SpecVersionSummary & { changes: SpecChange[]; counts: ChangeCounts }

const base = (accountId: string) => `/specs/${encodeURIComponent(accountId)}`

async function authedFile(path: string): Promise<{ blob: Blob; name: string }> {
  const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
  const token = getAccessToken()
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include'
  })

  if (!res.ok) throw new Error(`Download failed (${res.status})`)

  return {
    blob: await res.blob(),
    name: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'openapi.yaml'
  }
}

export const specsService = {
  overview: (accountId: string) => httpClient<SpecsOverview>({ url: base(accountId), method: 'GET' }),
  create: (
    accountId: string,
    data: { name: string; slug?: string; description?: string; document?: string; mockId?: string }
  ) => httpClient<SpecSummary>({ url: base(accountId), method: 'POST', data }),
  get: (accountId: string, id: string) => httpClient<Spec>({ url: `${base(accountId)}/${id}`, method: 'GET' }),
  save: (
    accountId: string,
    id: string,
    data: {
      name?: string
      slug?: string
      description?: string
      text?: string
      doc?: Record<string, unknown>
      expectedVersion?: number
    }
  ) => httpClient<Spec>({ url: `${base(accountId)}/${id}`, method: 'PUT', data }),
  preview: (accountId: string, id: string, text?: string) =>
    httpClient<SpecPreview>({
      url: `${base(accountId)}/${id}/preview`,
      method: 'POST',
      data: text === undefined ? {} : { text }
    }),
  publish: (accountId: string, id: string, notes: string) =>
    httpClient<PublishResult>({ url: `${base(accountId)}/${id}/publish`, method: 'POST', data: { notes } }),
  versions: (accountId: string, id: string) =>
    httpClient<{ versions: SpecVersionSummary[] }>({ url: `${base(accountId)}/${id}/versions`, method: 'GET' }),
  version: (accountId: string, id: string, vid: string) =>
    httpClient<SpecVersionSummary & { text: string; changes: SpecChange[]; model: DocsModel }>({
      url: `${base(accountId)}/${id}/versions/${vid}`,
      method: 'GET'
    }),
  restore: (accountId: string, id: string, vid: string) =>
    httpClient<{ id: string; number: number }>({
      url: `${base(accountId)}/${id}/versions/${vid}/restore`,
      method: 'POST',
      data: {}
    }),
  diff: (accountId: string, id: string, from: string, to: string) =>
    httpClient<{ from: string; to: string; changes: SpecChange[]; counts: ChangeCounts }>({
      url: `${base(accountId)}/${id}/diff?${new URLSearchParams({ from, to })}`,
      method: 'GET'
    }),
  sharing: (
    accountId: string,
    id: string,
    data: { visibility: Visibility; password?: string; tryMockId?: string | null }
  ) => httpClient<SpecSharing>({ url: `${base(accountId)}/${id}/sharing`, method: 'PUT', data }),
  setDomain: (accountId: string, id: string, hostname: string | null) =>
    httpClient<SpecSharing & { domainRecords?: DnsRecords }>({
      url: `${base(accountId)}/${id}/domain`,
      method: 'PUT',
      data: { hostname }
    }),
  checkDomain: (accountId: string, id: string) =>
    httpClient<SpecSharing & { routed: boolean; error: string | null; domainRecords?: DnsRecords }>({
      url: `${base(accountId)}/${id}/domain/check`,
      method: 'POST',
      data: {}
    }),
  remove: (accountId: string, id: string) =>
    httpClient<{ id: string }>({ url: `${base(accountId)}/${id}`, method: 'DELETE' }),
  exportFile: (accountId: string, id: string, format: 'yaml' | 'json', version = 'draft') =>
    authedFile(`${base(accountId)}/${id}/export?${new URLSearchParams({ format, version })}`)
}

// ── Public docs (no login; plain fetch without cookies, any origin) ──────────

export type PublicDocs = {
  name: string
  workspace: string
  slug: string
  number: number
  version: string
  publishedAt: string
  versions: Array<{ number: number; version: string; createdAt: string; breaking: number; notes: string }>
  canTry: boolean
  changes: SpecChange[]
  model: DocsModel
}

export type TryResult = {
  status: number
  headers: Record<string, string>
  body: string
  truncated: boolean
  ms: number
}

export class PublicDocsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly passwordRequired = false
  ) {
    super(message)
  }
}

const publicBase = () => `${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}/public/specs`

async function pub<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${publicBase()}${path}`, {
    ...init,
    credentials: 'omit',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-docs-token': token } : {})
    }
  })

  const json = (await res.json().catch(() => null)) as {
    message?: string
    data?: T & { passwordRequired?: boolean }
  } | null

  if (!res.ok)
    throw new PublicDocsError(
      json?.message ?? `Request failed (${res.status})`,
      res.status,
      Boolean(json?.data?.passwordRequired)
    )

  return json!.data as T
}

const seg = (s: string) => encodeURIComponent(s)

export const publicDocsService = {
  get: (workspace: string, slug: string, version?: number, token?: string | null) =>
    pub<PublicDocs>(`/${seg(workspace)}/${seg(slug)}${version ? `?version=${version}` : ''}`, {}, token),
  unlock: (workspace: string, slug: string, password: string) =>
    pub<{ token: string | null; hours?: number }>(`/${seg(workspace)}/${seg(slug)}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password })
    }),
  byHost: (host: string) => pub<{ workspace: string; slug: string; name: string }>(`/by-host/${seg(host)}`),
  tryIt: (
    workspace: string,
    slug: string,
    req: { method: string; path: string; headers: Record<string, string>; body?: string },
    token?: string | null
  ) => pub<TryResult>(`/${seg(workspace)}/${seg(slug)}/try`, { method: 'POST', body: JSON.stringify(req) }, token),
  downloadUrl: (workspace: string, slug: string, format: 'yaml' | 'json', version: number, token?: string | null) =>
    `${publicBase()}/${seg(workspace)}/${seg(slug)}/openapi?${new URLSearchParams({ format, version: String(version), ...(token ? { token } : {}) })}`
}
