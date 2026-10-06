import { describe, expect, it } from 'vitest'

import { dayHeading, describeActivity, isSystemEvent, roleName, type ActivityItem } from './activityFormat'

const item = (action: string, metadata: Record<string, unknown> = {}, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'x',
  at: '2026-10-06T10:00:00Z',
  action,
  category: 'other',
  actor: { id: 'u', name: 'Ada', email: 'ada@x.dev' },
  resourceType: 'Tunnel',
  resourceId: null,
  metadata,
  ...extra
})

describe('describeActivity', () => {
  it('reads like a sentence for known actions', () => {
    expect(describeActivity(item('API_KEY_CREATED', { name: 'ci' }))).toBe('created API key ci')
    expect(describeActivity(item('DOMAIN_ADDED', { hostname: 'api.acme.dev', label: 'web' }))).toBe('added custom domain api.acme.dev for web')
    expect(describeActivity(item('ACCOUNT_INVITATION_SENT', { email: 'b@x.dev', role: 70 }))).toBe('invited b@x.dev as admin')
    expect(describeActivity(item('ACCOUNT_MEMBER_ROLE_CHANGED', { newRoleLevel: 10 }, { target: { id: 't', name: 'Bo', email: 'bo@x' } }))).toBe('made Bo a member')
    expect(describeActivity(item('TUNNEL_ACCESS_UPDATED', { label: 'web', password: 'set' }))).toBe('changed access rules for web (password on)')
    expect(describeActivity(item('ALERT_RULE_UPDATED', { name: 'Down', enabled: false }))).toBe('paused alert Down')
  })

  it('tunnel connects are system events with durations', () => {
    const d = item('TUNNEL_DISCONNECTED', { label: 'api', durationMs: 3 * 3_600_000 + 5 * 60_000 }, { actor: null })

    expect(isSystemEvent(d)).toBe(true)
    expect(describeActivity(d)).toBe('Tunnel api disconnected after 3 h 5 min')
    expect(isSystemEvent(item('API_KEY_CREATED'))).toBe(false)
  })

  it('unknown actions still render', () => {
    expect(describeActivity(item('SOMETHING_NEW_HAPPENED'))).toBe('something new happened')
  })

  it('role names and day headings', () => {
    expect(roleName(100)).toBe('owner')
    expect(roleName(70)).toBe('admin')
    expect(roleName(10)).toBe('member')
    const now = new Date(2026, 9, 6, 12)

    expect(dayHeading(new Date(2026, 9, 6, 1).toISOString(), now)).toBe('Today')
    expect(dayHeading(new Date(2026, 9, 5, 23).toISOString(), now)).toBe('Yesterday')
  })
})
