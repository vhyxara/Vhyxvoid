// Pure helpers for the Performance page (unit-tested in perfForm.test.ts).

import type { EndpointSummary, LoadTestStart, LoadTestStatus, MonitorStatus } from '@/api/infrastructure/services/perf.service'

export const STATUS_VARIANT: Record<LoadTestStatus | MonitorStatus, 'success' | 'danger' | 'warning' | 'info' | 'default'> = {
  RUNNING: 'info',
  PASSED: 'success',
  FAILED: 'danger',
  CANCELLED: 'default',
  ERROR: 'warning',
  UP: 'success',
  DOWN: 'danger',
  PENDING: 'default'
}

export const STATUS_LABEL: Record<LoadTestStatus | MonitorStatus, string> = {
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ERROR: 'error',
  UP: 'up',
  DOWN: 'down',
  PENDING: 'not run yet'
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`

  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`

  return String(n)
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} s`
  const m = Math.floor(sec / 60)
  const s = sec % 60

  return s ? `${m} min ${s} s` : `${m} min`
}

export type EndpointSort = 'requests' | 'p95' | 'errorRate' | 'route'

export function sortEndpoints(list: EndpointSummary[], by: EndpointSort, filter = ''): EndpointSummary[] {
  const q = filter.trim().toLowerCase()
  const shown = list.filter(e => !q || `${e.method} ${e.route} ${e.label}`.toLowerCase().includes(q))
  const key: Record<EndpointSort, (e: EndpointSummary) => number | string> = {
    requests: e => -e.requests,
    p95: e => -(e.p95 ?? -1),
    errorRate: e => -e.errorRate,
    route: e => `${e.route} ${e.method}`
  }

  return [...shown].sort((a, b) => {
    const x = key[by](a)
    const y = key[by](b)

    return x < y ? -1 : x > y ? 1 : b.requests - a.requests
  })
}

/** Simple, readable presets; every field can be changed after picking one. */
export const LOAD_PRESETS = [
  { key: 'smoke', label: 'Smoke', help: '1 user for 10 s: does it work at all?', vus: 1, durationSec: 10, rampUpSec: 0, thinkTimeMs: 500 },
  { key: 'load', label: 'Average load', help: '10 users for 1 minute, ramping up over 10 s.', vus: 10, durationSec: 60, rampUpSec: 10, thinkTimeMs: 1000 },
  { key: 'stress', label: 'Stress', help: 'As many users as the plan allows, no pauses.', vus: 1000, durationSec: 60, rampUpSec: 20, thinkTimeMs: 0 },
  { key: 'spike', label: 'Spike', help: 'Everyone at once for 30 s.', vus: 1000, durationSec: 30, rampUpSec: 0, thinkTimeMs: 0 }
] as const

/** A preset fitted to the plan's limits. */
export function presetFor(key: string, limits: { maxVus: number; maxSeconds: number }) {
  const p = LOAD_PRESETS.find(x => x.key === key) ?? LOAD_PRESETS[0]
  const durationSec = Math.min(p.durationSec, limits.maxSeconds)

  return { vus: Math.max(1, Math.min(p.vus, limits.maxVus)), durationSec, rampUpSec: Math.min(p.rampUpSec, durationSec), thinkTimeMs: p.thinkTimeMs }
}

export type LoadForm = {
  name: string
  target: string
  method: string
  headers: string
  body: string
  vus: string
  durationSec: string
  rampUpSec: string
  thinkTimeMs: string
  maxRps: string
  p95Ms: string
  errorRatePct: string
  count4xxAsErrors: boolean
}

/** "Name: value" lines -> header pairs (blank and malformed lines skipped). */
export function parseHeaderLines(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const i = l.indexOf(':')

      return i > 0 ? ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string]) : null
    })
    .filter((h): h is [string, string] => !!h && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h[0]))
}

export function toStartBody(f: LoadForm): LoadTestStart {
  const int = (v: string, d = 0) => (v.trim() === '' || isNaN(Number(v)) ? d : Math.round(Number(v)))
  const num = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? undefined : Number(v))
  const thresholds = { p95Ms: num(f.p95Ms), errorRatePct: num(f.errorRatePct) }

  return {
    name: f.name.trim() || 'Load test',
    target: f.target.trim(),
    method: f.method,
    headers: parseHeaderLines(f.headers),
    ...(f.body.trim() && f.method !== 'GET' && f.method !== 'HEAD' ? { body: f.body } : {}),
    vus: int(f.vus, 1),
    durationSec: int(f.durationSec, 30),
    rampUpSec: int(f.rampUpSec),
    thinkTimeMs: int(f.thinkTimeMs),
    maxRps: int(f.maxRps),
    count4xxAsErrors: f.count4xxAsErrors,
    thresholds: Object.fromEntries(Object.entries(thresholds).filter(([, v]) => v !== undefined))
  }
}

/** Time label for a monitor check or an uptime bar. */
export function shortTime(iso: string, withDate = false): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return withDate ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}` : time
}

export function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  const future = s < 0
  const a = Math.abs(s)
  const v = a < 60 ? `${a} s` : a < 3600 ? `${Math.round(a / 60)} min` : a < 86_400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86_400)} d`

  return future ? `in ${v}` : `${v} ago`
}

/** Uptime bar color by share of passing checks; never color alone (the tooltip and table say it). */
export function uptimeColor(uptime: number | null): string {
  if (uptime === null) return 'var(--vhyx-color-bg-muted)'
  if (uptime >= 99.9) return 'var(--vhyx-color-success)'
  if (uptime >= 95) return 'var(--vhyx-color-warning)'

  return 'var(--vhyx-color-danger)'
}
