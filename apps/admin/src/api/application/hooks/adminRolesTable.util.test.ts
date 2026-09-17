import { describe, expect, it } from 'vitest'

import { paginateAdminRoles } from './adminRolesTable.util'
import type { AdminRoleSummary } from '@/api/domain/admin-roles/admin-role.types'

function makeRole(overrides: Partial<AdminRoleSummary>): AdminRoleSummary {
  return {
    id: overrides.id ?? 'id',
    name: overrides.name ?? 'Role',
    description: overrides.description ?? null,
    isSystem: overrides.isSystem ?? false,
    isActive: overrides.isActive ?? true
  }
}

describe('paginateAdminRoles — client-side search/sort/pagination', () => {
  const roles = [
    makeRole({ id: '1', name: 'Operator', description: 'Runs the floor', isSystem: true }),
    makeRole({ id: '2', name: 'Auditor', description: null, isSystem: true }),
    makeRole({ id: '3', name: 'Support Agent', description: 'Handles tickets', isSystem: false })
  ]

  it('with no search/sort, returns everything on page 1 in original order', () => {
    const result = paginateAdminRoles(roles, { page: 1, limit: 10 })

    expect(result.items.map(r => r.id)).toEqual(['1', '2', '3'])
    expect(result.total).toBe(3)
  })

  it('search matches name OR description, case-insensitively, and tolerates a null description', () => {
    expect(paginateAdminRoles(roles, { page: 1, limit: 10, search: 'AUDITOR' }).items.map(r => r.id)).toEqual(['2'])
    expect(paginateAdminRoles(roles, { page: 1, limit: 10, search: 'tickets' }).items.map(r => r.id)).toEqual(['3'])
    expect(paginateAdminRoles(roles, { page: 1, limit: 10, search: 'nobody' }).items).toEqual([])
  })

  it('sorts by name asc/desc', () => {
    const asc = paginateAdminRoles(roles, { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' })
    const desc = paginateAdminRoles(roles, { page: 1, limit: 10, sortBy: 'name', sortOrder: 'desc' })

    expect(asc.items.map(r => r.id)).toEqual(['2', '1', '3']) // Auditor, Operator, Support Agent
    expect(desc.items.map(r => r.id)).toEqual(['3', '1', '2'])
  })

  it('sorts by isSystem (custom < system ascending)', () => {
    const result = paginateAdminRoles(roles, { page: 1, limit: 10, sortBy: 'isSystem', sortOrder: 'asc' })

    expect(result.items[0].id).toBe('3') // the only custom role
  })

  it('an unrecognized sortBy falls back to sorting by name (the default case), not a no-op', () => {
    const result = paginateAdminRoles(roles, { page: 1, limit: 10, sortBy: 'somethingUnknown', sortOrder: 'asc' })

    expect(result.items.map(r => r.id)).toEqual(['2', '1', '3'])
  })

  it('paginates: page 2 with limit 2 returns the remaining item', () => {
    const result = paginateAdminRoles(roles, { page: 2, limit: 2 })

    expect(result.items.map(r => r.id)).toEqual(['3'])
    expect(result.total).toBe(3)
  })
})
