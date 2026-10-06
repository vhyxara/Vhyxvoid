// Form model for one traffic rule, and ready-made rules. Pure, so it is
// tested without a DOM. The API checks every rule again (same code as the hub).

import type { RuleAction, RuleActionType, RuleMethod, TrafficRule } from '@/api/infrastructure/services/trafficRules.service'

export const METHODS: RuleMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

export const ACTION_INFO: Record<RuleActionType, { title: string; help: string; answers: boolean }> = {
  mock: { title: 'Answer with a mock', help: 'Reply with this status, headers and body. Your app never sees the request.', answers: true },
  fail: { title: 'Inject an error', help: 'Reply with an error for a share of requests, to test how clients cope.', answers: true },
  redirect: { title: 'Redirect', help: 'Send the caller elsewhere. {path} in the location is the original path and query.', answers: true },
  delay: { title: 'Add latency', help: 'Wait before forwarding, to test slow networks and timeouts.', answers: false },
  rewrite: { title: 'Rewrite the path', help: 'Forward to a different path. With a pattern ending in *, the rest of the path is kept.', answers: false },
  requestHeaders: { title: 'Change request headers', help: 'Set or remove headers before the request reaches your app.', answers: false },
  responseHeaders: { title: 'Change response headers', help: 'Set or remove headers on the answer, e.g. CORS headers.', answers: false }
}

export type RuleForm = {
  id: string
  name: string
  enabled: boolean
  when: 'always' | 'offline'
  path: string
  methods: RuleMethod[]
  headerName: string
  headerValue: string
  type: RuleActionType
  status: string
  body: string
  /** "Name: value" per line. */
  headers: string
  percent: string
  location: string
  ms: string
  to: string
  /** Header names, one per line or comma separated. */
  remove: string
}

export function newRuleId(): string {
  return `r_${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
}

export function blankForm(type: RuleActionType = 'mock'): RuleForm {
  return {
    id: newRuleId(),
    name: ACTION_INFO[type].title,
    enabled: true,
    when: 'always',
    path: '*',
    methods: [],
    headerName: '',
    headerValue: '',
    type,
    status: type === 'fail' ? '503' : type === 'redirect' ? '302' : '200',
    body: '',
    headers: '',
    percent: '10',
    location: '',
    ms: '500',
    to: '/',
    remove: ''
  }
}

export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const line of text.split('\n')) {
    const i = line.indexOf(':')

    if (i <= 0) continue
    const name = line.slice(0, i).trim()

    if (name) out[name] = line.slice(i + 1).trim()
  }

  return out
}

const headerLines = (h?: Record<string, string>) =>
  Object.entries(h ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

const names = (text: string) =>
  text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)

export function formFromRule(r: TrafficRule): RuleForm {
  const f = blankForm(r.action.type)
  const a = r.action

  Object.assign(f, {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    when: r.when,
    path: r.match.path,
    methods: r.match.methods ?? [],
    headerName: r.match.header?.name ?? '',
    headerValue: r.match.header?.value ?? ''
  })
  if (a.type === 'mock') Object.assign(f, { status: String(a.status), body: a.body ?? '', headers: headerLines(a.headers) })
  if (a.type === 'fail') Object.assign(f, { status: String(a.status), percent: String(a.percent), body: a.body ?? '' })
  if (a.type === 'redirect') Object.assign(f, { status: String(a.status), location: a.location })
  if (a.type === 'delay') f.ms = String(a.ms)
  if (a.type === 'rewrite') f.to = a.to
  if (a.type === 'requestHeaders' || a.type === 'responseHeaders') Object.assign(f, { headers: headerLines(a.set), remove: (a.remove ?? []).join('\n') })

  return f
}

export function ruleFromForm(f: RuleForm): TrafficRule {
  let action: RuleAction

  switch (f.type) {
    case 'mock': {
      const headers = parseHeaderLines(f.headers)

      action = { type: 'mock', status: Number(f.status), ...(Object.keys(headers).length ? { headers } : {}), ...(f.body ? { body: f.body } : {}) }
      break
    }
    case 'fail':
      action = { type: 'fail', status: Number(f.status), percent: Number(f.percent), ...(f.body ? { body: f.body } : {}) }
      break
    case 'redirect':
      action = { type: 'redirect', status: Number(f.status) as 301 | 302 | 307 | 308, location: f.location.trim() }
      break
    case 'delay':
      action = { type: 'delay', ms: Number(f.ms) }
      break
    case 'rewrite':
      action = { type: 'rewrite', to: f.to.trim() }
      break
    default: {
      const set = parseHeaderLines(f.headers)
      const remove = names(f.remove)

      action = { type: f.type, ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { remove } : {}) }
    }
  }

  return {
    id: f.id,
    name: f.name.trim(),
    enabled: f.enabled,
    when: ACTION_INFO[f.type].answers ? f.when : 'always',
    match: {
      path: f.path.trim() || '*',
      ...(f.methods.length ? { methods: f.methods } : {}),
      ...(f.headerName.trim() ? { header: { name: f.headerName.trim(), ...(f.headerValue.trim() ? { value: f.headerValue.trim() } : {}) } } : {})
    },
    action
  }
}

/** One line per rule, same wording as the API's summary. */
export function summarize(r: TrafficRule): string {
  const where = `${r.match.methods?.length ? r.match.methods.join('/') : 'any'} ${r.match.path}${r.when === 'offline' ? ' while offline' : ''}`
  const a = r.action

  switch (a.type) {
    case 'mock':
      return `${where} → answer ${a.status}`
    case 'fail':
      return `${where} → ${a.status} for ${a.percent}% of requests`
    case 'redirect':
      return `${where} → ${a.status} to ${a.location}`
    case 'delay':
      return `${where} → wait ${a.ms} ms`
    case 'rewrite':
      return `${where} → forward to ${a.to}`
    case 'requestHeaders':
      return `${where} → change request headers`
    case 'responseHeaders':
      return `${where} → change response headers`
  }
}

export const TEMPLATES: Array<{ key: string; title: string; description: string; make: () => TrafficRule }> = [
  {
    key: 'mock-json',
    title: 'Mock a JSON endpoint',
    description: 'Answer GET /api/example with JSON before the backend exists.',
    make: () => ({
      id: newRuleId(),
      name: 'Mock /api/example',
      enabled: true,
      when: 'always',
      match: { path: '/api/example', methods: ['GET'] },
      action: { type: 'mock', status: 200, headers: { 'Content-Type': 'application/json' }, body: '{\n  "ok": true\n}' }
    })
  },
  {
    key: 'offline',
    title: 'Maintenance page while offline',
    description: 'When your agent is not connected, answer 503 with a friendly page instead of an error.',
    make: () => ({
      id: newRuleId(),
      name: 'Maintenance page',
      enabled: true,
      when: 'offline',
      match: { path: '*' },
      action: {
        type: 'mock',
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '120' },
        body: '<!doctype html><title>Back soon</title><h1>Back in a few minutes</h1><p>This app is being updated.</p>'
      }
    })
  },
  {
    key: 'cors',
    title: 'Allow cross-origin requests (CORS)',
    description: 'Add Access-Control-Allow-* headers to every answer.',
    make: () => ({
      id: newRuleId(),
      name: 'CORS',
      enabled: true,
      when: 'always',
      match: { path: '*' },
      action: {
        type: 'responseHeaders',
        set: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' }
      }
    })
  },
  {
    key: 'latency',
    title: 'Slow network',
    description: 'Add 800 ms before every request reaches your app.',
    make: () => ({ id: newRuleId(), name: 'Slow network', enabled: true, when: 'always', match: { path: '*' }, action: { type: 'delay', ms: 800 } })
  },
  {
    key: 'chaos',
    title: 'Random failures',
    description: 'Answer 503 for 10% of requests to /api/*.',
    make: () => ({ id: newRuleId(), name: 'Random 503s', enabled: true, when: 'always', match: { path: '/api/*' }, action: { type: 'fail', status: 503, percent: 10 } })
  },
  {
    key: 'version',
    title: 'Route an old API version',
    description: 'Forward /v1/* to /v2/* without changing clients.',
    make: () => ({ id: newRuleId(), name: 'v1 → v2', enabled: true, when: 'always', match: { path: '/v1/*' }, action: { type: 'rewrite', to: '/v2' } })
  }
]

/** A mock rule that answers like a captured response (the inspector's "Mock this response"). */
export function ruleFromCapture(c: { method: string; path: string; status: number; contentType?: string | null; body?: string | null }): TrafficRule {
  const path = c.path.split('?')[0] || '/'
  const method = (METHODS as string[]).includes(c.method.toUpperCase()) ? (c.method.toUpperCase() as RuleMethod) : undefined

  return {
    id: newRuleId(),
    name: `Mock ${method ?? ''} ${path}`.replace(/\s+/g, ' ').trim().slice(0, 80),
    enabled: true,
    when: 'always',
    match: { path, ...(method ? { methods: [method] } : {}) },
    action: {
      type: 'mock',
      status: c.status >= 200 && c.status <= 599 ? c.status : 200,
      ...(c.contentType ? { headers: { 'Content-Type': c.contentType } } : {}),
      ...(c.body ? { body: c.body.slice(0, 64 * 1024) } : {})
    }
  }
}

export const DRAFT_KEY = 'vv:traffic-rule-draft'
