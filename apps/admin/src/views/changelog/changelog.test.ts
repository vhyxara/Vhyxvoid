import { describe, expect, it } from 'vitest'

import { entryState } from './ChangelogView'

describe('changelog entries', () => {
  it('are drafts, scheduled or published', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')

    expect(entryState({ status: 'DRAFT', publishedAt: null }, now)).toBe('Draft')
    expect(entryState({ status: 'PUBLISHED', publishedAt: '2026-10-01T00:00:00Z' }, now)).toBe('Published')
    expect(entryState({ status: 'PUBLISHED', publishedAt: '2026-11-01T00:00:00Z' }, now)).toBe('Scheduled')
  })
})
