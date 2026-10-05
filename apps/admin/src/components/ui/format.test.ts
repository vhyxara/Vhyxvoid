import { describe, expect, it } from 'vitest'

import { fillDays, formatLimit } from './format'

describe('format helpers', () => {
  it('fillDays returns one point per day ending today, zero-filled', () => {
    const today = new Date().toISOString().slice(0, 10)
    const out = fillDays([{ day: today, value: 5 }], 7)

    expect(out).toHaveLength(7)
    expect(out[6]).toEqual({ day: today, value: 5 })
    expect(out.slice(0, 6).every(p => p.value === 0)).toBe(true)
  })

  it('formatLimit shows null and Infinity as Unlimited', () => {
    expect(formatLimit(null)).toBe('Unlimited')
    expect(formatLimit(Infinity)).toBe('Unlimited')
    expect(formatLimit(true)).toBe('Yes')
    expect(formatLimit(['DEV', 'PROD'])).toBe('DEV, PROD')
  })
})
