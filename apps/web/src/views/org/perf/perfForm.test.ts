import { describe, expect, it } from 'vitest'

import type { EndpointSummary } from '@/api/infrastructure/services/perf.service'
import { formatCount, formatDuration, formatMs, parseHeaderLines, presetFor, relative, sortEndpoints, toStartBody, uptimeColor } from './perfForm'

const ep = (over: Partial<EndpointSummary>): EndpointSummary => ({ label: 'api', method: 'GET', route: '/x', sample: '/x', requests: 1, rpm: 0, s2xx: 1, s3xx: 0, s4xx: 0, s5xx: 0, errorRate: 0, avgMs: 1, p50: 1, p90: 1, p95: 1, p99: 1, maxMs: 1, firstSeen: '', lastSeen: '', isNew: false, trend: [], ...over })

describe('perfForm', () => {
  it('formats numbers, times and durations', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(12.4)).toBe('12 ms')
    expect(formatMs(2500)).toBe('2.50 s')
    expect(formatCount(1500)).toBe('1.5k')
    expect(formatCount(25_000)).toBe('25k')
    expect(formatDuration(90)).toBe('1 min 30 s')
    expect(relative(new Date(Date.now() - 120_000).toISOString())).toBe('2 min ago')
    expect(relative(new Date(Date.now() + 30_000).toISOString())).toMatch(/^in \d+ s$/)
  })

  it('sorts and filters endpoints', () => {
    const list = [ep({ route: '/b', requests: 5, p95: 900 }), ep({ route: '/a', requests: 50, p95: 20, errorRate: 3 }), ep({ route: '/c', requests: 1, p95: null })]

    expect(sortEndpoints(list, 'requests').map(e => e.route)).toEqual(['/a', '/b', '/c'])
    expect(sortEndpoints(list, 'p95').map(e => e.route)).toEqual(['/b', '/a', '/c'])
    expect(sortEndpoints(list, 'errorRate')[0].route).toBe('/a')
    expect(sortEndpoints(list, 'route', 'b').map(e => e.route)).toEqual(['/b'])
  })

  it('fits presets to the plan and builds the start body', () => {
    expect(presetFor('stress', { maxVus: 10, maxSeconds: 30 })).toEqual({ vus: 10, durationSec: 30, rampUpSec: 20, thinkTimeMs: 0 })
    expect(parseHeaderLines('Authorization: Bearer x\nbad line\nX-A:1\n: nope')).toEqual([['Authorization', 'Bearer x'], ['X-A', '1']])
    expect(
      toStartBody({ name: ' ', target: ' https://a--b.vv.test/ ', method: 'GET', headers: '', body: '{"x":1}', vus: '5', durationSec: '20', rampUpSec: '', thinkTimeMs: '100', maxRps: '', p95Ms: '300', errorRatePct: '', count4xxAsErrors: true })
    ).toEqual({ name: 'Load test', target: 'https://a--b.vv.test/', method: 'GET', headers: [], vus: 5, durationSec: 20, rampUpSec: 0, thinkTimeMs: 100, maxRps: 0, count4xxAsErrors: true, thresholds: { p95Ms: 300 } })
  })

  it('colors uptime by threshold', () => {
    expect(uptimeColor(null)).toContain('bg-muted')
    expect(uptimeColor(100)).toContain('success')
    expect(uptimeColor(97)).toContain('warning')
    expect(uptimeColor(50)).toContain('danger')
  })
})
