// Pure helpers for the mock API editor (unit-tested in mockForm.test.ts).
import type { MockEndpoint, MockMethod, MockResponse, MockRule, MockRuleOp, MockRuleSource } from '@/api/infrastructure/services/mocks.service'

export const METHODS: MockMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY', 'HEAD', 'OPTIONS']

/** Badge colours per method, like most API tools. */
export const METHOD_VARIANT: Record<MockMethod, 'success' | 'info' | 'warning' | 'danger' | 'default'> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
  ANY: 'default',
  HEAD: 'default',
  OPTIONS: 'default'
}

export const RULE_SOURCES: Array<{ value: MockRuleSource; label: string; needsKey: boolean; keyHint: string }> = [
  { value: 'query', label: 'Query parameter', needsKey: true, keyHint: 'page' },
  { value: 'header', label: 'Header', needsKey: true, keyHint: 'authorization' },
  { value: 'param', label: 'Path parameter', needsKey: true, keyHint: 'id' },
  { value: 'body', label: 'JSON body field', needsKey: false, keyHint: 'user.email (empty = whole body)' },
  { value: 'cookie', label: 'Cookie', needsKey: true, keyHint: 'session' },
  { value: 'method', label: 'Method', needsKey: false, keyHint: '' },
  { value: 'path', label: 'Path', needsKey: false, keyHint: '' }
]

export const RULE_OPS: Array<{ value: MockRuleOp; label: string; needsValue: boolean }> = [
  { value: 'equals', label: 'equals', needsValue: true },
  { value: 'not_equals', label: 'is not', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'exists', label: 'is present', needsValue: false },
  { value: 'not_exists', label: 'is missing', needsValue: false },
  { value: 'regex', label: 'matches regex', needsValue: true }
]

export const STATUS_PRESETS = [200, 201, 204, 301, 302, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]

/** What the templating cheat sheet shows; click to insert. */
export const TEMPLATE_TAGS: Array<{ tag: string; help: string }> = [
  { tag: '{{request.params.id}}', help: 'Path parameter' },
  { tag: '{{request.query.page}}', help: 'Query parameter' },
  { tag: '{{request.body.email}}', help: 'JSON body field (dots for nesting)' },
  { tag: '{{request.headers.authorization}}', help: 'Request header' },
  { tag: '{{json request.body}}', help: 'Whole body as JSON' },
  { tag: '{{uuid}}', help: 'Random UUID' },
  { tag: '{{now}}', help: 'Current time (ISO)' },
  { tag: '{{int 1 100}}', help: 'Whole number in a range' },
  { tag: '{{float 0 1 2}}', help: 'Decimal, with digits' },
  { tag: "{{pick 'a' 'b'}}", help: 'One of the values' },
  { tag: '{{fullName}}', help: 'Person name (also firstName, lastName)' },
  { tag: '{{email}}', help: 'Email address' },
  { tag: '{{company}}', help: 'Company (also city, country)' },
  { tag: '{{lorem 8}}', help: 'Words of filler text' },
  { tag: '{{bool}}', help: 'true or false' },
  { tag: '{{#repeat 3}}…,{{/repeat}}', help: 'Repeat a block (a list); {{@index}} inside' }
]

let seq = 0
export function newId(prefix: 'e' | 'r'): string {
  seq = (seq + 1) % 1_000_000

  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newResponse(over: Partial<MockResponse> = {}): MockResponse {
  return { id: newId('r'), name: 'OK', status: 200, headers: { 'content-type': 'application/json' }, body: '{\n  "ok": true\n}', ...over }
}

export function newEndpoint(existing: MockEndpoint[], over: Partial<MockEndpoint> = {}): MockEndpoint {
  // A path that doesn't collide with an existing GET, so a fresh endpoint is reachable at once.
  let path = '/new'
  for (let i = 2; existing.some(e => e.path === path && e.method === 'GET'); i++) path = `/new-${i}`

  return { id: newId('e'), name: '', enabled: true, method: 'GET', path, selection: 'rules', responses: [newResponse({ isDefault: true })], ...over }
}

export function duplicateEndpoint(e: MockEndpoint): MockEndpoint {
  return {
    ...structuredClone(e),
    id: newId('e'),
    name: e.name ? `${e.name} (copy)` : '',
    responses: e.responses.map(r => ({ ...structuredClone(r), id: newId('r') }))
  }
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  const [item] = next.splice(from, 1)

  next.splice(to, 0, item)

  return next
}

/** Pretty-prints JSON bodies; leaves anything else (and templates) as is. */
export function formatBody(body: string): { body: string; error: string | null } {
  if (!body.trim()) return { body, error: null }

  try {
    return { body: JSON.stringify(JSON.parse(body), null, 2), error: null }
  } catch (err) {
    return { body, error: (err as Error).message }
  }
}

/** A hint (not an error: templates and text are allowed) when a JSON response body isn't valid JSON. */
export function bodyWarning(r: Pick<MockResponse, 'body' | 'templating' | 'headers'>): string | null {
  const ct = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  const body = r.body ?? ''

  if (!body.trim() || r.templating || !ct.includes('json')) return null

  try {
    JSON.parse(body)

    return null
  } catch (err) {
    return `Not valid JSON: ${(err as Error).message}`
  }
}

export function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'Start with /'
  if (/[\s?#]/.test(path)) return 'No spaces, ? or #'
  if (path.length > 500) return 'At most 500 characters'

  return null
}

/** Path parameter names in a path pattern, for rule suggestions. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/(?:^|\/)(?::([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_.-]*)\})(?=\/|$)/g)].map(m => m[1] ?? m[2])
}

export function describeRule(r: MockRule): string {
  const src = RULE_SOURCES.find(s => s.value === r.source)?.label.toLowerCase() ?? r.source
  const op = RULE_OPS.find(o => o.value === r.op)

  return `${src}${r.key ? ` ${r.key}` : ''} ${op?.label ?? r.op}${op?.needsValue ? ` “${r.value ?? ''}”` : ''}`
}

/** Header rows for the editor (keeps empty rows while typing) and back. */
export type HeaderRow = { key: string; value: string }
export const headersToRows = (h: Record<string, string> | undefined): HeaderRow[] => Object.entries(h ?? {}).map(([key, value]) => ({ key, value }))
export const rowsToHeaders = (rows: HeaderRow[]): Record<string, string> =>
  Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]))

/** Ensures exactly one default response when there are rules, so "no rule matched" is explicit. */
export function setDefault(responses: MockResponse[], id: string): MockResponse[] {
  return responses.map(r => ({ ...r, isDefault: r.id === id }))
}

/** A path to call for an endpoint: params filled with examples. */
export function examplePath(e: Pick<MockEndpoint, 'path'>): string {
  return e.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)|\{([^}]+)\}/g, '1').replace(/\/\*$/, '/example')
}

/**
 * The response that answers when no rules match, chosen exactly like the
 * engine (packages/shared/src/mockApi.ts chooseResponse): the default, else
 * the first without rules, else the first.
 */
export function fallbackResponse(rs: MockResponse[]): MockResponse | undefined {
  return rs.find(r => r.isDefault) ?? rs.find(r => !r.rules?.length) ?? rs[0]
}

/** The URL to call for an endpoint: params filled with examples so it can be clicked. */
export function exampleUrl(base: string | null, e: Pick<MockEndpoint, 'path'>): string | null {
  if (!base) return null

  return `${base}${examplePath(e)}`
}

/** curl for an endpoint, for the copy button. */
export function curlFor(base: string | null, e: Pick<MockEndpoint, 'path' | 'method'>): string | null {
  const url = exampleUrl(base, e)

  if (!url) return null
  const method = e.method === 'ANY' ? 'GET' : e.method
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? ` -H 'content-type: application/json' -d '{}'` : ''

  return `curl -i${method === 'GET' ? '' : ` -X ${method}`} '${url}'${body}`
}

export const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function labelFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
