import { describe, expect, it } from 'vitest'

import { paginateAdminUsers, parseStatusFilter } from './adminUsersTable.util'
import type { AdminUserSummary } from '@/api/domain/admin-users/admin-user.types'

function makeUser(overrides: Partial<AdminUserSummary>): AdminUserSummary {
  return {
    id: overrides.id ?? 'id',
    email: overrides.email ?? 'user@example.com',
    firstName: overrides.firstName ?? 'First',
    lastName: overrides.lastName ?? 'Last',
    fullName: overrides.fullName ?? 'First Last',
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    status: overrides.status ?? true,
    lastLoginAt: overrides.lastLoginAt ?? null
  }
}

describe('parseStatusFilter', () => {
  it('parses "true"/"false" strings, everything else is undefined', () => {
    expect(parseStatusFilter('true')).toBe(true)
    expect(parseStatusFilter('false')).toBe(false)
    expect(parseStatusFilter(undefined)).toBeUndefined()
    expect(parseStatusFilter('')).toBeUndefined()
    expect(parseStatusFilter('garbage')).toBeUndefined()
  })
})

describe('paginateAdminUsers — client-side search/sort/pagination', () => {
  const users = [
    makeUser({ id: '1', email: 'charlie@example.com', fullName: 'Charlie Davis', status: true, lastLoginAt: '2026-09-01T00:00:00.000Z' }),
    makeUser({ id: '2', email: 'alice@example.com', fullName: 'Alice Brown', status: false, lastLoginAt: null }),
    makeUser({ id: '3', email: 'bob@example.com', fullName: 'Bob Adams', status: true, lastLoginAt: '2026-09-10T00:00:00.000Z' })
  ]

  it('with no search/sort, returns everything on page 1 in original order', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10 })

    expect(result.items.map(u => u.id)).toEqual(['1', '2', '3'])
    expect(result.total).toBe(3)
  })

  it('search matches email OR fullName, case-insensitively', () => {
    expect(paginateAdminUsers(users, { page: 1, limit: 10, search: 'ALICE' }).items.map(u => u.id)).toEqual(['2'])
    expect(paginateAdminUsers(users, { page: 1, limit: 10, search: 'adams' }).items.map(u => u.id)).toEqual(['3'])
    expect(paginateAdminUsers(users, { page: 1, limit: 10, search: 'nobody' }).items).toEqual([])
  })

  it('sorts by email asc/desc', () => {
    const asc = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'email', sortOrder: 'asc' })
    const desc = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'email', sortOrder: 'desc' })

    expect(asc.items.map(u => u.id)).toEqual(['2', '3', '1']) // alice, bob, charlie
    expect(desc.items.map(u => u.id)).toEqual(['1', '3', '2'])
  })

  it('sorts by fullName', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'fullName', sortOrder: 'asc' })

    expect(result.items.map(u => u.id)).toEqual(['2', '3', '1']) // Alice Brown, Bob Adams, Charlie Davis
  })

  it('sorts by status (boolean, false < true ascending)', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'status', sortOrder: 'asc' })

    expect(result.items[0].id).toBe('2') // the only disabled one
  })

  it('sorts by lastLoginAt, with null treated as earliest', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'lastLoginAt', sortOrder: 'asc' })

    expect(result.items.map(u => u.id)).toEqual(['2', '1', '3']) // null, then 09-01, then 09-10
  })

  it('an unrecognized sortBy falls back to sorting by email (the default case), not a no-op', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10, sortBy: 'somethingUnknown', sortOrder: 'asc' })

    expect(result.items.map(u => u.id)).toEqual(['2', '3', '1'])
  })

  it('paginates correctly, and total reflects the FILTERED count, not the page size', () => {
    const page1 = paginateAdminUsers(users, { page: 1, limit: 2 })
    const page2 = paginateAdminUsers(users, { page: 2, limit: 2 })

    expect(page1.items.map(u => u.id)).toEqual(['1', '2'])
    expect(page1.total).toBe(3)
    expect(page2.items.map(u => u.id)).toEqual(['3'])
    expect(page2.total).toBe(3)
  })

  it('search narrows total too (pagination is computed over the filtered set)', () => {
    const result = paginateAdminUsers(users, { page: 1, limit: 10, search: 'example.com' })

    expect(result.total).toBe(3)

    const narrowed = paginateAdminUsers(users, { page: 1, limit: 10, search: 'alice' })

    expect(narrowed.total).toBe(1)
  })
})
