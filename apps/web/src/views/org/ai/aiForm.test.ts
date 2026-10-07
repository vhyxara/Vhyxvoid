import { describe, expect, it } from 'vitest'

import { aiSourceProblem, aiUsageText } from './aiForm'

describe('aiSourceProblem', () => {
  const base = { source: 'description' as const, description: 'A bookstore API with books', label: '', specId: '', baseUrl: '' }

  it('needs enough description, a tunnel or docs, and a usable base URL', () => {
    expect(aiSourceProblem(base)).toBeNull()
    expect(aiSourceProblem({ ...base, description: 'books' })).toMatch(/Describe/)
    expect(aiSourceProblem({ ...base, source: 'traffic', description: '' })).toBe('Pick a tunnel')
    expect(aiSourceProblem({ ...base, source: 'traffic', description: '', label: 'shop' })).toBeNull()
    expect(aiSourceProblem({ ...base, source: 'spec', description: '' })).toBe('Pick API docs')
    expect(aiSourceProblem({ ...base, baseUrl: 'staging.example.com' })).toMatch(/http/)
    expect(aiSourceProblem({ ...base, description: 'x'.repeat(4001) })).toMatch(/4,000/)
  })
})

describe('aiUsageText', () => {
  it('counts what is left and when it resets', () => {
    const now = new Date('2026-10-07T12:00:00Z')

    expect(aiUsageText({ used: 3, limit: 20, resetsAt: '2026-11-01T00:00:00Z' }, now)).toBe('17 of 20 drafts left this month.')
    expect(aiUsageText({ used: 20, limit: 20, resetsAt: '2026-11-01T00:00:00Z' }, now)).toBe('You used all 20 drafts this month; more in 25 days.')
    expect(aiUsageText({ used: 1, limit: null, resetsAt: '2026-11-01T00:00:00Z' }, now)).toBe('1 draft this month.')
  })
})
