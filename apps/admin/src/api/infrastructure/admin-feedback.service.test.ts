import { describe, expect, it } from 'vitest'

import { buildFeedbackQuery } from './admin-feedback.service'
import type { FetchParams } from '@/libs/table/GenericServerTable'

function makeParams(overrides: Partial<FetchParams>): FetchParams {
  return { page: 1, limit: 20, ...overrides }
}

describe('buildFeedbackQuery', () => {
  it('always sends page and limit', () => {
    const query = buildFeedbackQuery(makeParams({ page: 2, limit: 10 }))

    expect(query).toBe('page=2&limit=10')
  })

  it('adds status/type/priority when present in filters -- all three are combinable, not mutually exclusive', () => {
    const query = buildFeedbackQuery(makeParams({ filters: { status: 'OPEN', type: 'BUG_REPORT', priority: 'HIGH' } }))

    expect(query).toBe('page=1&limit=20&status=OPEN&type=BUG_REPORT&priority=HIGH')
  })

  it('omits a filter key entirely when unset, rather than sending an empty value', () => {
    const query = buildFeedbackQuery(makeParams({ filters: { status: 'RESOLVED' } }))

    expect(query).toBe('page=1&limit=20&status=RESOLVED')
  })

  it('never sends search/sortBy/sortOrder -- the backend supports none of them', () => {
    const query = buildFeedbackQuery(makeParams({ search: 'crash', sortBy: 'title', sortOrder: 'asc' }))

    expect(query).toBe('page=1&limit=20')
  })
})
