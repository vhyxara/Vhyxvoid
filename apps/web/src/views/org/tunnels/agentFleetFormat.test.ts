import { describe, expect, it } from 'vitest'

import { formatUptime, sinceText } from './agentFleetFormat'

describe('agentFleetFormat', () => {
  it('uptime reads at a glance', () => {
    expect(formatUptime(45)).toBe('45s')
    expect(formatUptime(12 * 60)).toBe('12m')
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3h 5m')
    expect(formatUptime(2 * 3600)).toBe('2h')
    expect(formatUptime(52 * 3600)).toBe('2d 4h')
  })

  it('last ping', () => {
    const now = Date.parse('2026-10-06T12:00:00Z')

    expect(sinceText('2026-10-06T11:59:58Z', now)).toBe('just now')
    expect(sinceText('2026-10-06T11:59:40Z', now)).toBe('20s ago')
    expect(sinceText('2026-10-06T11:57:00Z', now)).toBe('3m ago')
  })
})
