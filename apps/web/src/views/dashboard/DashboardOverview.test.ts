import { describe, expect, it } from 'vitest'

import { buildChecklist, pickPrimaryAccount } from './DashboardOverview'

const acct = (accountId: string, accountType: string) => ({ accountId, accountType }) as any

describe('pickPrimaryAccount', () => {
  it('prefers the personal workspace', () => {
    expect(pickPrimaryAccount([acct('a', 'ORGANIZATION'), acct('b', 'PERSONAL')])?.accountId).toBe('b')
  })

  it('falls back to the first, or nothing', () => {
    expect(pickPrimaryAccount([acct('a', 'ORGANIZATION')])?.accountId).toBe('a')
    expect(pickPrimaryAccount([])).toBeUndefined()
    expect(pickPrimaryAccount(undefined)).toBeUndefined()
  })
})

describe('buildChecklist', () => {
  it('marks each step from real signals', () => {
    const steps = buildChecklist({ emailVerified: true, activeApiKeys: 0, activeTunnels: 0, totalRequests: 3 })

    expect(steps.map(s => s.done)).toEqual([true, false, true])
  })
})
