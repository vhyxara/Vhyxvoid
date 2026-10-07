import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/perf.ts and apps/api/src/modules/platform/perf.

export type AnalyticsWindow = '1h' | '6h' | '24h' | '7d'

export type EndpointSummary = {
  label: string
  method: string
  route: string
  sample: string
  requests: number
  rpm: number
  s2xx: number
  s3xx: number
  s4xx: number
  s5xx: number
  errorRate: number
  avgMs: number
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
  maxMs: number
  firstSeen: string
  lastSeen: string
  isNew: boolean
  trend: number[]
}

export type AnalyticsOverview = {
  window: AnalyticsWindow
  from: string
  to: string
  labels: string[]
  totals: { requests: number; endpoints: number; errorRate: number; clientErrorRate: number; avgMs: number; p50: number | null; p95: number | null; p99: number | null }
  endpoints: EndpointSummary[]
  newEndpoints: EndpointSummary[]
  slowest: EndpointSummary[]
  failing: EndpointSummary[]
}

export type EndpointDetail = {
  window: AnalyticsWindow
  stepMinutes: number
  summary: EndpointSummary
  points: Array<{ t: string; requests: number; s4xx: number; s5xx: number; avgMs: number | null; p50: number | null; p95: number | null; p99: number | null }>
}

export type DriftReport = {
  spec: { name: string; operations: number }
  window: AnalyticsWindow
  observed: number
  undocumented: Array<{ method: string; route: string; sample: string; requests: number }>
  unused: Array<{ method: string; path: string }>
  unexpectedStatuses: Array<{ method: string; route: string; path: string; statusClass: string; requests: number }>
  matched: number
  coverage: number
}

export type LatencySummary = { min: number; avg: number; p50: number; p90: number; p95: number; p99: number; max: number }

export type LoadTestSummary = {
  requests: number
  durationSec: number
  rps: number
  errors: number
  errorRate: number
  bytes: number
  statuses: Record<string, number>
  failures: Record<string, number>
  latency: LatencySummary
  maxVus: number
  thresholds: Array<{ name: string; limit: number; actual: number; pass: boolean }>
  passed: boolean
  stoppedEarly?: string
}

export type LoadTimelinePoint = { t: number; vus: number; requests: number; errors: number; s2xx: number; s3xx: number; s4xx: number; s5xx: number; p50: number; p95: number; p99: number; avg: number }

export type LoadThresholds = { p95Ms?: number; p99Ms?: number; avgMs?: number; errorRatePct?: number; minRps?: number }

export type LoadTestConfig = {
  request: { method: string; url: string; headers: Array<[string, string]>; body?: string }
  vus: number
  durationSec: number
  rampUpSec: number
  thinkTimeMs: number
  maxRps: number
  count4xxAsErrors?: boolean
  thresholds?: LoadThresholds
}

export type LoadTestStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'ERROR'

export type LoadTestRun = {
  id: string
  name: string
  target: string
  status: LoadTestStatus
  config: LoadTestConfig
  summary: LoadTestSummary | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  timeline?: LoadTimelinePoint[]
  cancelRequested?: boolean
}

export type LoadTarget = { kind: 'tunnel' | 'mock' | 'domain'; name: string; url: string }

export type LoadTestsOverview = {
  enabled: boolean
  limits: { maxVus: number; maxSeconds: number; maxRps: number; perDay: number; usedToday: number }
  targets: LoadTarget[]
  runs: LoadTestRun[]
}

export type LoadTestStart = {
  name: string
  target: string
  method: string
  headers: Array<[string, string]>
  body?: string
  vus: number
  durationSec: number
  rampUpSec: number
  thinkTimeMs: number
  maxRps: number
  count4xxAsErrors: boolean
  thresholds: LoadThresholds
}

export type LoadComparison = { metric: string; a: number; b: number; change: number | null; better: boolean | null }

export type MonitorStatus = 'PENDING' | 'UP' | 'DOWN'

export type Monitor = {
  id: string
  name: string
  collectionId: string
  collectionName?: string
  environmentId: string | null
  folderId: string | null
  intervalMinutes: number
  enabled: boolean
  status: MonitorStatus
  consecutiveFailures: number
  lastRunAt: string | null
  nextRunAt: string
  lastDurationMs: number | null
  lastError: string | null
  uptime24h: number | null
}

export type MonitorsOverview = {
  enabled: boolean
  canManage: boolean
  limits: { max: number; minInterval: number; intervals: number[] }
  collections: Array<{ id: string; name: string; folders: Array<{ id: string; name: string }> }>
  environments: Array<{ id: string; name: string }>
  monitors: Monitor[]
}

export type MonitorInput = { name: string; collectionId: string; environmentId: string | null; folderId: string | null; intervalMinutes: number; enabled?: boolean }

export type UptimeBar = { from: string; checks: number; ok: number; uptime: number | null; avgMs: number | null }

export type MonitorCheck = { id: string; at: string; ok: boolean; durationMs: number; passed: number; total: number; failed?: number; errored?: number }

export type MonitorDetail = {
  monitor: Monitor
  window: '24h' | '7d' | '30d'
  uptime: { checks: number; ok: number; uptime: number | null; avgMs: number | null; bars: UptimeBar[] }
  checks: MonitorCheck[]
  recent: MonitorCheck[]
}

const a = (accountId: string) => encodeURIComponent(accountId)

export const analyticsService = {
  overview: (accountId: string, window: AnalyticsWindow, label?: string) =>
    httpClient<AnalyticsOverview>({ url: `/analytics/${a(accountId)}`, method: 'GET', params: { window, label } }),
  endpoint: (accountId: string, q: { window: AnalyticsWindow; label: string; method: string; route: string }) =>
    httpClient<EndpointDetail>({ url: `/analytics/${a(accountId)}/endpoint`, method: 'GET', params: q }),
  drift: (accountId: string, data: { window: AnalyticsWindow; label?: string; mockId?: string; document?: string }) =>
    httpClient<DriftReport>({ url: `/analytics/${a(accountId)}/drift`, method: 'POST', data })
}

export const loadTestsService = {
  overview: (accountId: string) => httpClient<LoadTestsOverview>({ url: `/load-tests/${a(accountId)}`, method: 'GET' }),
  start: (accountId: string, data: LoadTestStart) => httpClient<LoadTestRun>({ url: `/load-tests/${a(accountId)}`, method: 'POST', data }),
  get: (accountId: string, id: string) => httpClient<LoadTestRun>({ url: `/load-tests/${a(accountId)}/${id}`, method: 'GET' }),
  cancel: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `/load-tests/${a(accountId)}/${id}/cancel`, method: 'POST' }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `/load-tests/${a(accountId)}/${id}`, method: 'DELETE' }),
  compare: (accountId: string, idA: string, idB: string) =>
    httpClient<{ a: LoadTestRun; b: LoadTestRun; rows: LoadComparison[] }>({ url: `/load-tests/${a(accountId)}/compare`, method: 'GET', params: { a: idA, b: idB } })
}

export const monitorsService = {
  overview: (accountId: string) => httpClient<MonitorsOverview>({ url: `/monitors/${a(accountId)}`, method: 'GET' }),
  create: (accountId: string, data: MonitorInput) => httpClient<Monitor>({ url: `/monitors/${a(accountId)}`, method: 'POST', data }),
  save: (accountId: string, id: string, data: Partial<MonitorInput>) => httpClient<Monitor>({ url: `/monitors/${a(accountId)}/${id}`, method: 'PUT', data }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `/monitors/${a(accountId)}/${id}`, method: 'DELETE' }),
  run: (accountId: string, id: string) =>
    httpClient<{ ok: boolean; consecutiveFailures: number; report: { total: number; passed: number; failed: number; errored: number; durationMs: number } }>({ url: `/monitors/${a(accountId)}/${id}/run`, method: 'POST', timeoutMs: 90_000 }),
  detail: (accountId: string, id: string, window: '24h' | '7d' | '30d') => httpClient<MonitorDetail>({ url: `/monitors/${a(accountId)}/${id}`, method: 'GET', params: { window } }),
  result: (accountId: string, id: string, rid: string) =>
    httpClient<MonitorCheck & { report: import('./apiClient.service').RunReport | null }>({ url: `/monitors/${a(accountId)}/${id}/results/${rid}`, method: 'GET' })
}
