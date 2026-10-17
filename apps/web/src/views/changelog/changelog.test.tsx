import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ChangelogView, changelogAnchors } from './ChangelogView'

const entry = (over: object) => ({ id: Math.random().toString(36), version: '', title: 'T', body: '', kinds: [], publishedAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', ...over })

describe('changelog', () => {
  it('anchors releases by version, else by date, without repeats', () => {
    expect(changelogAnchors([entry({ version: '1.8.0' }), entry({ version: 'v1.8.0' }), entry({}), entry({})])).toEqual(['v1-8-0', 'v1-8-0-1', '2026-10-01', '2026-10-01-1'])
  })

  it('shows entries with their date, version, kinds and notes', () => {
    render(<ChangelogView page={1} list={{ items: [entry({ version: '1.8.0', title: 'Request replay', kinds: ['new', 'fixed'], body: '- Replay any request' })], total: 1, page: 1, pages: 1 }} />)
    expect(screen.getByRole('heading', { name: 'Request replay' })).toBeTruthy()
    expect(screen.getByText('v1.8.0')).toBeTruthy()
    expect(screen.getByText('October 1, 2026')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Kind of change' }).textContent).toBe('NewFixed')
    expect(screen.getByText('Replay any request')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Get updates by email' })).toBeTruthy()
  })

  it('says when there is nothing yet', () => {
    render(<ChangelogView page={1} list={{ items: [], total: 0, page: 1, pages: 1 }} newsletter={false} />)
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Get updates by email' })).toBeNull()
  })
})
