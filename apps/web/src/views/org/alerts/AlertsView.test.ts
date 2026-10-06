import { describe, expect, it } from 'vitest'

import { deliverySummary, toRuleInput } from './AlertsView'

describe('toRuleInput', () => {
  it('parses numbers, splits emails, drops fields the type does not use', () => {
    expect(
      toRuleInput({ type: 'ERROR_RATE', name: ' Errors ', label: 'api', threshold: '15', windowMinutes: '10', minRequests: '', notifyMembers: true, emails: 'a@x.com, b@x.com\nc@x.com', webhookUrl: ' ' })
    ).toEqual({ type: 'ERROR_RATE', name: 'Errors', label: 'api', threshold: 15, windowMinutes: 10, minRequests: null, notifyMembers: true, emails: ['a@x.com', 'b@x.com', 'c@x.com'], webhookUrl: null })
    expect(toRuleInput({ type: 'USAGE', name: 'u', label: 'api', threshold: '80', windowMinutes: '5', minRequests: '9', notifyMembers: false, emails: '', webhookUrl: 'https://h' })).toMatchObject({
      label: null,
      threshold: 80,
      windowMinutes: null,
      minRequests: null,
      webhookUrl: 'https://h'
    })
  })
})

describe('deliverySummary', () => {
  it('reads like a sentence', () => {
    expect(deliverySummary({ email: 2, inApp: 1, webhook: 'ok' })).toBe('2 emails · 1 in-app · webhook ok')
    expect(deliverySummary({ suppressed: true })).toBe('not sent (hourly limit)')
    expect(deliverySummary(null)).toBe('')
  })
})
