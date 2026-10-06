import { describe, expect, it } from 'vitest'

import { compactNumber, formatMs, niceTicks, stackOf, xTickIndices } from './trafficChartModel'

describe('trafficChartModel', () => {
  it('nice ticks cover the maximum with round steps', () => {
    expect(niceTicks(0)).toEqual({ top: 4, ticks: [2, 4] })
    expect(niceTicks(7)).toEqual({ top: 9, ticks: [3, 6, 9] })
    const big = niceTicks(1234)

    expect(big.top).toBeGreaterThanOrEqual(1234)
    expect(big.ticks.length).toBeGreaterThanOrEqual(2)
    expect(big.ticks.length).toBeLessThanOrEqual(4)
    expect(big.ticks[big.ticks.length - 1]).toBe(big.top)
  })

  it('stacks successful, 4xx and 5xx without going negative', () => {
    expect(stackOf({ t: '', requests: 10, errors4xx: 3, errors5xx: 2, avgMs: 1 })).toEqual({ ok: 5, errors4xx: 3, errors5xx: 2 })
    expect(stackOf({ t: '', requests: 1, errors4xx: 3, errors5xx: 0, avgMs: 1 }).ok).toBe(0)
  })

  it('x ticks are spread out and always end on the last bucket', () => {
    expect(xTickIndices(96, 5)).toEqual([0, 24, 48, 72, 95])
    expect(xTickIndices(1)).toEqual([0])
    expect(xTickIndices(0)).toEqual([])
    const t = xTickIndices(60, 3)

    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBe(59)
  })

  it('formats numbers and durations compactly', () => {
    expect(compactNumber(950)).toBe('950')
    expect(compactNumber(1500)).toBe('1.5k')
    expect(compactNumber(2_000_000)).toBe('2M')
    expect(formatMs(null)).toBe('—')
    expect(formatMs(120)).toBe('120 ms')
    expect(formatMs(1500)).toBe('1.50 s')
  })
})
