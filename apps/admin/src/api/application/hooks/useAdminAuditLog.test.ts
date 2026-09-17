import { describe, expect, it } from 'vitest'

import { buildAuditLogQuery, sliceAuditLogPage } from './useAdminAuditLog'
import type { AdminAuditLogEntry } from '@/api/domain/admin-audit-log/admin-audit-log.types'

function makeEntry(id: string): AdminAuditLogEntry {
  return {
    id,
    adminId: 'admin-1',
    action: 'role.created',
    actionDescription: 'Role created',
    targetType: 'AdminRole',
    targetId: null,
    changes: null,
    metadata: null,
    createdAt: '2026-09-17T00:00:00.000Z'
  }
}

describe('buildAuditLogQuery', () => {
  it('with no filter, sends only limit/offset (the findAll branch)', () => {
    expect(buildAuditLogQuery({ type: 'none', value: '' }, 1, 10)).toEqual({ limit: 11, offset: 0 })
  })

  it('computes offset from page and limit, and over-fetches by one row', () => {
    expect(buildAuditLogQuery({ type: 'none', value: '' }, 3, 20)).toEqual({ limit: 21, offset: 40 })
  })

  it('an admin filter sends adminId only', () => {
    expect(buildAuditLogQuery({ type: 'admin', value: 'admin-1' }, 1, 10)).toEqual({
      limit: 11,
      offset: 0,
      adminId: 'admin-1'
    })
  })

  it('an action filter sends action only', () => {
    expect(buildAuditLogQuery({ type: 'action', value: 'role.created' }, 1, 10)).toEqual({
      limit: 11,
      offset: 0,
      action: 'role.created'
    })
  })

  it('a target filter sends targetId only', () => {
    expect(buildAuditLogQuery({ type: 'target', value: 'target-1' }, 1, 10)).toEqual({
      limit: 11,
      offset: 0,
      targetId: 'target-1'
    })
  })

  it('a filter type with an empty value is treated as no filter (dropdown selected but nothing typed yet)', () => {
    expect(buildAuditLogQuery({ type: 'action', value: '' }, 1, 10)).toEqual({ limit: 11, offset: 0 })
  })
})

describe('sliceAuditLogPage — deriving hasNextPage without a real total', () => {
  it('exactly `limit` rows back means no next page (the common, non-overfetch case)', () => {
    const rows = [makeEntry('1'), makeEntry('2')]
    const result = sliceAuditLogPage(rows, 2)

    expect(result.items.map(r => r.id)).toEqual(['1', '2'])
    expect(result.hasNextPage).toBe(false)
  })

  it('`limit + 1` rows back means a next page exists, and the extra row is sliced off', () => {
    const rows = [makeEntry('1'), makeEntry('2'), makeEntry('3')]
    const result = sliceAuditLogPage(rows, 2)

    expect(result.items.map(r => r.id)).toEqual(['1', '2'])
    expect(result.hasNextPage).toBe(true)
  })

  it('fewer than `limit` rows (the last page) means no next page', () => {
    const rows = [makeEntry('1')]
    const result = sliceAuditLogPage(rows, 10)

    expect(result.items.map(r => r.id)).toEqual(['1'])
    expect(result.hasNextPage).toBe(false)
  })

  it('zero rows means no next page', () => {
    const result = sliceAuditLogPage([], 10)

    expect(result.items).toEqual([])
    expect(result.hasNextPage).toBe(false)
  })
})
