import { describe, expect, it } from 'vitest'

import { paginateAdminAbilities } from './adminAbilitiesTable.util'
import type { AdminAbilitySummary } from '@/api/domain/admin-abilities/admin-ability.types'

function makeAbility(overrides: Partial<AdminAbilitySummary>): AdminAbilitySummary {
  return {
    id: overrides.id ?? 'id',
    action: overrides.action ?? 'ability.read',
    category: overrides.category ?? 'abilities',
    description: overrides.description ?? null,
    isSystem: overrides.isSystem ?? true,
    isActive: overrides.isActive ?? true
  }
}

describe('paginateAdminAbilities — client-side search/sort/pagination', () => {
  const abilities = [
    makeAbility({ id: '1', action: 'role.assign', category: 'roles', description: 'Assign roles to admins' }),
    makeAbility({ id: '2', action: 'audit.read', category: 'audit_logs', description: null }),
    makeAbility({ id: '3', action: 'invoice.export', category: 'billing', description: 'Export invoices', isSystem: false })
  ]

  it('with no search/sort, returns everything on page 1 in original order', () => {
    const result = paginateAdminAbilities(abilities, { page: 1, limit: 10 })

    expect(result.items.map(a => a.id)).toEqual(['1', '2', '3'])
    expect(result.total).toBe(3)
  })

  it('search matches action, category, OR description, case-insensitively, and tolerates a null description', () => {
    expect(paginateAdminAbilities(abilities, { page: 1, limit: 10, search: 'AUDIT' }).items.map(a => a.id)).toEqual(['2'])
    expect(paginateAdminAbilities(abilities, { page: 1, limit: 10, search: 'billing' }).items.map(a => a.id)).toEqual(['3'])
    expect(paginateAdminAbilities(abilities, { page: 1, limit: 10, search: 'invoices' }).items.map(a => a.id)).toEqual(['3'])
    expect(paginateAdminAbilities(abilities, { page: 1, limit: 10, search: 'nobody' }).items).toEqual([])
  })

  it('sorts by action asc/desc', () => {
    const asc = paginateAdminAbilities(abilities, { page: 1, limit: 10, sortBy: 'action', sortOrder: 'asc' })
    const desc = paginateAdminAbilities(abilities, { page: 1, limit: 10, sortBy: 'action', sortOrder: 'desc' })

    expect(asc.items.map(a => a.id)).toEqual(['2', '3', '1']) // audit.read, invoice.export, role.assign
    expect(desc.items.map(a => a.id)).toEqual(['1', '3', '2'])
  })

  it('sorts by category', () => {
    const result = paginateAdminAbilities(abilities, { page: 1, limit: 10, sortBy: 'category', sortOrder: 'asc' })

    expect(result.items.map(a => a.id)).toEqual(['2', '3', '1']) // audit_logs, billing, roles
  })

  it('sorts by isSystem (custom < system ascending)', () => {
    const result = paginateAdminAbilities(abilities, { page: 1, limit: 10, sortBy: 'isSystem', sortOrder: 'asc' })

    expect(result.items[0].id).toBe('3') // the only custom ability
  })

  it('an unrecognized sortBy falls back to sorting by action (the default case), not a no-op', () => {
    const result = paginateAdminAbilities(abilities, { page: 1, limit: 10, sortBy: 'somethingUnknown', sortOrder: 'asc' })

    expect(result.items.map(a => a.id)).toEqual(['2', '3', '1'])
  })

  it('paginates: page 2 with limit 2 returns the remaining item', () => {
    const result = paginateAdminAbilities(abilities, { page: 2, limit: 2 })

    expect(result.items.map(a => a.id)).toEqual(['3'])
    expect(result.total).toBe(3)
  })
})
