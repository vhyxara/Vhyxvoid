import { describe, expect, it } from 'vitest'

import { statusBadge } from './InboxView'

describe('statusBadge', () => {
  it('shows what happened in words', () => {
    expect(statusBadge({ status: 'QUEUED', responseStatus: null })).toEqual({ label: 'waiting', variant: 'info' })
    expect(statusBadge({ status: 'DELIVERED', responseStatus: 200 })).toEqual({ label: 'delivered · 200', variant: 'success' })
    expect(statusBadge({ status: 'DELIVERED', responseStatus: 400 }).variant).toBe('warning')
    expect(statusBadge({ status: 'FAILED', responseStatus: 500 }).variant).toBe('danger')
  })
})
