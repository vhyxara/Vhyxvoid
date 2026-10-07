// Pure helpers for the API client (unit-tested in apiClientForm.test.ts).

import type {
  ApiAssertion,
  ApiAuth,
  ApiBody,
  ApiCapture,
  ApiFolder,
  ApiMethod,
  ApiRequest,
  ApiResponse,
  AssertionOp,
  AssertionSource,
  KeyValue,
  Timings
} from '@/api/infrastructure/services/apiClient.service'

export const METHODS: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export const METHOD_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'default' | 'outline'> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
  HEAD: 'outline',
  OPTIONS: 'outline'
}

export const statusVariant = (status: number | null | undefined) => (!status ? 'default' : status < 300 ? 'success' : status < 400 ? 'info' : status < 500 ? 'warning' : 'danger')

let seq = 0

export const uid = (prefix: 'q' | 'a' | 'c' | 'f') => {
  seq = (seq + 1) % 1_000_000

  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newRequest(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: uid('q'),
    name: 'New request',
    method: 'GET',
    url: '{{baseUrl}}/',
    params: [],
    headers: [],
    auth: { type: 'inherit' },
    body: { type: 'none' },
    assertions: [{ id: uid('a'), enabled: true, source: 'status', op: 'lt', value: '400' }],
    captures: [],
    folderId: null,
    ...over
  }
}

export function duplicateRequest(r: ApiRequest): ApiRequest {
  return {
    ...structuredClone(r),
    id: uid('q'),
    name: `${r.name} copy`.slice(0, 120),
    assertions: r.assertions.map(a => ({ ...a, id: uid('a') })),
    captures: r.captures.map(c => ({ ...c, id: uid('c') }))
  }
}

// ── URL <-> query params ─────────────────────────────────────────────────────

/** Splits "https://x/a?b=1&c" into a base URL and params, keeping {{vars}} as typed. */
export function splitUrl(url: string): { base: string; params: KeyValue[] } {
  const q = url.indexOf('?')

  if (q === -1) return { base: url, params: [] }

  const dec = (s: string) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '))
    } catch {
      return s
    }
  }

  const params = url
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map(pair => {
      const eq = pair.indexOf('=')

      return { key: dec(eq === -1 ? pair : pair.slice(0, eq)), value: eq === -1 ? '' : dec(pair.slice(eq + 1)), enabled: true }
    })

  return { base: url.slice(0, q), params }
}

/** What the URL bar shows: the base URL plus the enabled params. */
export function joinUrl(base: string, params: KeyValue[]): string {
  const enc = (s: string) => (s.includes('{{') ? s : encodeURIComponent(s))
  const on = params.filter(p => p.enabled && p.key)

  return on.length ? `${base}?${on.map(p => `${enc(p.key)}${p.value === '' ? '' : `=${enc(p.value)}`}`).join('&')}` : base
}

/** Typing a URL with a query string moves the query into the params (disabled ones stay). */
export function applyUrlInput(req: ApiRequest, typed: string): Pick<ApiRequest, 'url' | 'params'> {
  const { base, params } = splitUrl(typed)
  const disabled = req.params.filter(p => !p.enabled)

  return { url: base, params: [...params, ...disabled] }
}

// ── Variables ────────────────────────────────────────────────────────────────

const VAR_RE = /\{\{\s*(\$?[A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g

export const DYNAMIC_VARS = ['$uuid', '$timestamp', '$isoTimestamp', '$randomInt']

export function varsIn(text: string | undefined): string[] {
  if (!text) return []

  return [...text.matchAll(VAR_RE)].map(m => m[1])
}

/** Names a request uses that no layer defines (dynamic ones excluded). */
export function undefinedVars(req: ApiRequest, defined: Set<string>): string[] {
  const texts: Array<string | undefined> = [req.url, ...req.params.filter(p => p.enabled).flatMap(p => [p.key, p.value]), ...req.headers.filter(h => h.enabled).flatMap(h => [h.key, h.value])]
  const a = req.auth

  if (a.type === 'bearer') texts.push(a.token)
  if (a.type === 'basic') texts.push(a.username, a.password)
  if (a.type === 'apiKey') texts.push(a.name, a.value)
  if (a.type === 'hmac') texts.push(a.secret)
  const b = req.body

  if (b.type === 'json' || b.type === 'raw') texts.push(b.text)
  if (b.type === 'graphql') texts.push(b.query, b.variables)
  if (b.type === 'form' || b.type === 'multipart') texts.push(...b.fields.filter(f => f.enabled).flatMap(f => [f.key, f.value]))

  return [...new Set(texts.flatMap(varsIn))].filter(n => !n.startsWith('$') && !defined.has(n))
}

export const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/

// ── Body ─────────────────────────────────────────────────────────────────────

export const BODY_TYPES: Array<{ value: ApiBody['type']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'form', label: 'Form (urlencoded)' },
  { value: 'multipart', label: 'Multipart form' },
  { value: 'raw', label: 'Raw text' },
  { value: 'file', label: 'File' }
]

/** Switching body type keeps what can be kept (text between JSON and raw, fields between the two forms). */
export function convertBody(b: ApiBody, to: ApiBody['type']): ApiBody {
  if (b.type === to) return b
  const text = b.type === 'json' || b.type === 'raw' ? b.text : ''
  const fields = b.type === 'form' || b.type === 'multipart' ? b.fields.map(({ key, value, enabled }) => ({ key, value, enabled })) : []

  switch (to) {
    case 'none':
      return { type: 'none' }
    case 'json':
      return { type: 'json', text: text || '{\n  \n}' }
    case 'graphql':
      return { type: 'graphql', query: 'query {\n  \n}', variables: '' }
    case 'form':
      return { type: 'form', fields }
    case 'multipart':
      return { type: 'multipart', fields }
    case 'raw':
      return { type: 'raw', text, contentType: 'text/plain' }
    case 'file':
      return { type: 'file', name: '', contentType: 'application/octet-stream', base64: '' }
  }
}

export function jsonProblem(text: string): string | null {
  if (!text.trim() || /\{\{/.test(text)) return null
  try {
    JSON.parse(text)

    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const AUTH_TYPES: Array<{ value: ApiAuth['type']; label: string }> = [
  { value: 'inherit', label: 'From the collection' },
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic' },
  { value: 'apiKey', label: 'API key' },
  { value: 'hmac', label: 'HMAC signature' }
]

export function newAuth(type: ApiAuth['type']): ApiAuth {
  switch (type) {
    case 'bearer':
      return { type, token: '{{token}}' }
    case 'basic':
      return { type, username: '', password: '' }
    case 'apiKey':
      return { type, name: 'X-API-Key', value: '{{apiKey}}', in: 'header' }
    case 'hmac':
      return { type, secret: '{{signingSecret}}', algorithm: 'sha256', encoding: 'hex', header: 'X-Signature', prefix: 'sha256=' }
    default:
      return { type } as ApiAuth
  }
}

// ── Checks and captures ──────────────────────────────────────────────────────

export const ASSERTION_SOURCES: Array<{ value: AssertionSource; label: string }> = [
  { value: 'status', label: 'Status' },
  { value: 'json', label: 'JSON path' },
  { value: 'header', label: 'Header' },
  { value: 'body', label: 'Body text' },
  { value: 'time', label: 'Response time (ms)' },
  { value: 'size', label: 'Size (bytes)' }
]

export const ASSERTION_OPS: Array<{ value: AssertionOp; label: string; needsValue: boolean }> = [
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'neq', label: 'is not', needsValue: true },
  { value: 'lt', label: '<', needsValue: true },
  { value: 'lte', label: '≤', needsValue: true },
  { value: 'gt', label: '>', needsValue: true },
  { value: 'gte', label: '≥', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'notContains', label: "doesn't contain", needsValue: true },
  { value: 'exists', label: 'exists', needsValue: false },
  { value: 'notExists', label: "doesn't exist", needsValue: false },
  { value: 'matches', label: 'matches regex', needsValue: true },
  { value: 'type', label: 'is of type', needsValue: true },
  { value: 'schema', label: 'matches JSON schema', needsValue: true }
]

/** Which operators make sense for a source. */
export function opsFor(source: AssertionSource): AssertionOp[] {
  switch (source) {
    case 'status':
    case 'time':
    case 'size':
      return ['eq', 'neq', 'lt', 'lte', 'gt', 'gte']
    case 'header':
      return ['eq', 'neq', 'contains', 'notContains', 'exists', 'notExists', 'matches']
    case 'body':
      return ['contains', 'notContains', 'matches', 'eq', 'schema']
    case 'json':
      return ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'notContains', 'exists', 'notExists', 'matches', 'type', 'schema']
  }
}

export function newAssertion(source: AssertionSource = 'status'): ApiAssertion {
  const op = source === 'status' ? 'eq' : source === 'time' ? 'lt' : source === 'json' ? 'exists' : 'contains'

  return { id: uid('a'), enabled: true, source, op, value: source === 'status' ? '200' : source === 'time' ? '500' : '', path: source === 'json' ? '$.' : source === 'header' ? 'content-type' : undefined }
}

export function newCapture(): ApiCapture {
  return { id: uid('c'), enabled: true, variable: '', source: 'json', path: '$.' }
}

/** Quick checks from a response: status, content type, response time, and the top-level JSON keys. */
export function suggestAssertions(res: ApiResponse): ApiAssertion[] {
  const out: ApiAssertion[] = [{ id: uid('a'), enabled: true, source: 'status', op: 'eq', value: String(res.status) }]
  const ct = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]

  if (ct) out.push({ id: uid('a'), enabled: true, source: 'header', path: 'content-type', op: 'contains', value: ct.split(';')[0] })
  out.push({ id: uid('a'), enabled: true, source: 'time', op: 'lt', value: String(Math.max(200, Math.ceil((res.timings.total * 3) / 100) * 100)) })

  if (res.bodyEncoding === 'utf8') {
    try {
      const v = JSON.parse(res.body)

      if (Array.isArray(v)) out.push({ id: uid('a'), enabled: true, source: 'json', path: '$', op: 'type', value: 'array' })
      else if (v && typeof v === 'object') for (const k of Object.keys(v).slice(0, 5)) out.push({ id: uid('a'), enabled: true, source: 'json', path: /^[A-Za-z_$][\w$]*$/.test(k) ? `$.${k}` : `$[${JSON.stringify(k)}]`, op: 'exists' })
    } catch {
      /* not JSON */
    }
  }

  return out
}

// ── Response ─────────────────────────────────────────────────────────────────

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`

  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export type TimingSegment = { key: keyof Timings; label: string; ms: number; offset: number }

/** Waterfall segments (DNS, connect, TLS, waiting, download) as offsets in ms. */
export function timingSegments(t: Timings): TimingSegment[] {
  const parts: Array<[keyof Timings, string]> = [
    ['dns', 'DNS lookup'],
    ['connect', 'TCP connect'],
    ['tls', 'TLS handshake'],
    ['firstByte', 'Waiting (server)'],
    ['download', 'Download']
  ]

  let offset = 0
  const out: TimingSegment[] = []

  for (const [key, label] of parts) {
    const ms = Math.max(0, t[key])

    out.push({ key, label, ms, offset })
    offset += ms
  }

  return out
}

export type BodyView = { kind: 'json' | 'html' | 'xml' | 'text' | 'image' | 'binary'; text: string }

/** How to show a body: pretty JSON, text, an image (data URL) or a binary note. */
export function bodyView(res: Pick<ApiResponse, 'body' | 'bodyEncoding' | 'headers' | 'size'>): BodyView {
  const ct = (res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '').toLowerCase()

  if (res.bodyEncoding === 'base64') {
    if (ct.startsWith('image/') && !ct.includes('svg')) return { kind: 'image', text: `data:${ct.split(';')[0]};base64,${res.body}` }

    return { kind: 'binary', text: `${formatBytes(res.size)} of ${ct || 'binary data'}` }
  }

  if (ct.includes('json') || /^\s*[[{]/.test(res.body)) {
    try {
      return { kind: 'json', text: JSON.stringify(JSON.parse(res.body), null, 2) }
    } catch {
      /* fall through */
    }
  }

  if (ct.includes('html')) return { kind: 'html', text: res.body }
  if (ct.includes('xml')) return { kind: 'xml', text: res.body }

  return { kind: 'text', text: res.body }
}

// ── Tree ─────────────────────────────────────────────────────────────────────

export type TreeNode = { kind: 'folder'; folder: ApiFolder; depth: number; children: TreeNode[] } | { kind: 'request'; request: ApiRequest; depth: number }

export function buildTree(folders: ApiFolder[], requests: ApiRequest[], filter = ''): TreeNode[] {
  const q = filter.trim().toLowerCase()
  const matches = (r: ApiRequest) => !q || `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(q)
  const ids = new Set(folders.map(f => f.id))

  const level = (parent: string | null, depth: number, seen: Set<string>): TreeNode[] => {
    const subs: TreeNode[] = folders
      .filter(f => (f.parentId ?? null) === parent && !seen.has(f.id))
      .map(f => ({ kind: 'folder' as const, folder: f, depth, children: level(f.id, depth + 1, new Set([...seen, f.id])) }))
      .filter(n => !q || n.children.length > 0 || n.folder.name.toLowerCase().includes(q))

    const reqs: TreeNode[] = requests.filter(r => ((r.folderId && ids.has(r.folderId) ? r.folderId : null) ?? null) === parent && matches(r)).map(r => ({ kind: 'request' as const, request: r, depth }))

    // Same order as a run: a level's requests, then its folders.
    return [...reqs, ...subs]
  }

  return level(null, 0, new Set())
}

/** A folder and everything below it. */
export function folderDescendants(folders: ApiFolder[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true

  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }

  return out
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [x] = next.splice(from, 1)

  next.splice(to, 0, x)

  return next
}

// ── Files ────────────────────────────────────────────────────────────────────

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
