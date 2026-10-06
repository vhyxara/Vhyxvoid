// Pure layout helpers for TrafficChart (tested without a DOM).

import type { TrafficPoint } from '@/api/infrastructure/services/traffic.service'

/** Series in stack order, bottom to top. Colors validated for the dark surface (dataviz validator, all checks pass). */
export const TRAFFIC_SERIES = [
  { key: 'ok', label: 'Successful', color: 'var(--vv-chart-ok, #8B5CF6)' },
  { key: 'errors4xx', label: '4xx', color: 'var(--vv-chart-4xx, #B08A00)' },
  { key: 'errors5xx', label: '5xx', color: 'var(--vv-chart-5xx, #EC4899)' }
] as const

export type SeriesKey = (typeof TRAFFIC_SERIES)[number]['key']

export function stackOf(p: TrafficPoint): Record<SeriesKey, number> {
  return { ok: Math.max(0, p.requests - p.errors4xx - p.errors5xx), errors4xx: p.errors4xx, errors5xx: p.errors5xx }
}

/** A "nice" axis maximum and 2-4 evenly spaced ticks (0 excluded). */
export function niceTicks(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [2, 4] }
  const rough = max / 3
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= rough) ?? 10 * pow
  const stepInt = Math.max(1, Math.round(step))
  const top = Math.ceil(max / stepInt) * stepInt
  const ticks: number[] = []

  for (let v = stepInt; v <= top; v += stepInt) ticks.push(v)

  return { top, ticks }
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`

  return String(n)
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`

  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

/** Bucket start as a short label: time of day for ranges up to a day, weekday + time beyond. */
export function bucketLabel(iso: string, bucketMinutes: number, withDate = false): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (bucketMinutes >= 60 || withDate) return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`

  return time
}

/** Indices for x-axis labels: about `count` evenly spaced, always including the last. */
export function xTickIndices(length: number, count = 5): number[] {
  if (length <= 1) return length ? [0] : []
  const step = Math.max(1, Math.round((length - 1) / (count - 1)))
  const out: number[] = []

  for (let i = 0; i < length; i += step) out.push(i)
  if (out[out.length - 1] !== length - 1) {
    if (length - 1 - out[out.length - 1] < step / 2) out.pop()
    out.push(length - 1)
  }

  return out
}
