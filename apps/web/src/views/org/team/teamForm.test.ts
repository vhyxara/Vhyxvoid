import { describe, expect, it } from 'vitest'

import {
  anchorer,
  buildTree,
  descendants,
  dropNeighbours,
  dueState,
  groupedWithPrevious,
  headingAnchor,
  insertMention,
  mentionQuery,
  mentionsIn,
  moveInColumns,
  toEditable,
  toStored,
  withMentionLinks
} from './teamForm'

const ADA = '11111111-2222-4333-8444-555555555555'
const ADAL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const people = [
  { id: ADA, name: 'Ada', email: 'a@x', level: 10 },
  { id: ADAL, name: 'Ada Lovelace', email: 'al@x', level: 10 }
]

describe('mentions in the composer', () => {
  it('detects the query being typed', () => {
    expect(mentionQuery('hi @ad', 6)).toEqual({ query: 'ad', start: 3 })
    expect(mentionQuery('@', 1)).toEqual({ query: '', start: 0 })
    expect(mentionQuery('mail a@b', 8)).toBeNull()
    expect(mentionQuery('hi @ada lov', 11)).toBeNull()
  })

  it('inserts, stores and edits mentions', () => {
    const ins = insertMention('hi @ad please', 3, 6, 'Ada Lovelace')

    expect(ins).toEqual({ text: 'hi @Ada Lovelace  please', caret: 17 })
    const stored = toStored('@Ada Lovelace and @Ada, not email@Ada or @Adam', { Ada: ADA, 'Ada Lovelace': ADAL })

    expect(stored).toBe(`<@${ADAL}> and <@${ADA}>, not email@Ada or @Adam`)
    expect(toEditable(stored, people)).toEqual({
      text: '@Ada Lovelace and @Ada, not email@Ada or @Adam',
      picked: { 'Ada Lovelace': ADAL, Ada: ADA }
    })
    expect(withMentionLinks(`hey <@${ADA}>`, people)).toBe(`hey [@Ada](mention:${ADA})`)
    expect(withMentionLinks(`<@${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}>`, people)).toContain('[@someone]')
    expect(mentionsIn(`<@${ADA}> <@${ADA.toUpperCase()}>`)).toEqual([ADA])
  })
})

describe('messages', () => {
  it('groups consecutive messages of one author within 5 minutes', () => {
    const a = { authorId: 'u', createdAt: '2026-10-07T10:00:00Z' }

    expect(groupedWithPrevious(a, { authorId: 'u', createdAt: '2026-10-07T10:04:00Z' })).toBe(true)
    expect(groupedWithPrevious(a, { authorId: 'u', createdAt: '2026-10-07T10:06:00Z' })).toBe(false)
    expect(groupedWithPrevious(a, { authorId: 'v', createdAt: '2026-10-07T10:01:00Z' })).toBe(false)
    expect(groupedWithPrevious(undefined, a)).toBe(false)
  })
})

describe('issues', () => {
  it('due states', () => {
    const today = new Date('2026-10-07T12:00:00Z')

    expect(dueState('2026-10-06', false, today)).toBe('overdue')
    expect(dueState('2026-10-07', false, today)).toBe('today')
    expect(dueState('2026-10-09', false, today)).toBe('soon')
    expect(dueState('2026-10-20', false, today)).toBe('later')
    expect(dueState('2026-10-01', true, today)).toBeNull()
    expect(dueState(null, false, today)).toBeNull()
  })

  it('board drops: neighbours and the optimistic order agree', () => {
    expect(dropNeighbours([1, 2, 3], 9, 0)).toEqual({ before: null, after: 1 })
    expect(dropNeighbours([1, 2, 3], 9, 3)).toEqual({ before: 3, after: null })
    expect(dropNeighbours([1, 2, 3], 2, 2)).toEqual({ before: 3, after: null })
    expect(dropNeighbours([], 2, 5)).toEqual({ before: null, after: null })
    const items = [
      { number: 1, status: 'TODO' as const },
      { number: 2, status: 'TODO' as const },
      { number: 3, status: 'DONE' as const }
    ]

    expect(moveInColumns(items, 3, 'TODO', 1).map(i => `${i.number}${i.status[0]}`)).toEqual(['1T', '3T', '2T'])
    expect(moveInColumns(items, 1, 'DONE', 5).map(i => `${i.number}${i.status[0]}`)).toEqual(['2T', '3D', '1D'])
    expect(moveInColumns(items, 2, 'TODO', 0).map(i => i.number)).toEqual([2, 1, 3])
  })
})

describe('documents', () => {
  it('anchors match the shared outline (GitHub style, repeats numbered)', () => {
    expect(headingAnchor('Links & *more*')).toBe('links--more')
    expect(headingAnchor('Café: déjà vu?')).toBe('café-déjà-vu')
    const a = anchorer()

    expect([a('Install'), a('Install'), a('Other')]).toEqual(['install', 'install-1', 'other'])
  })

  it('builds the folder tree and knows descendants', () => {
    const folders = [
      { id: 'a', parentId: null, name: 'Runbooks' },
      { id: 'b', parentId: 'a', name: 'Payments' },
      { id: 'c', parentId: null, name: 'API' }
    ]
    const docs = [
      { id: 'd1', title: 'Zeta', folderId: null, updatedAt: '', updatedBy: null, createdById: null },
      { id: 'd2', title: 'Alpha', folderId: null, updatedAt: '', updatedBy: null, createdById: null },
      { id: 'd3', title: 'Deploy', folderId: 'b', updatedAt: '', updatedBy: null, createdById: null },
      { id: 'd4', title: 'Lost', folderId: 'gone', updatedAt: '', updatedBy: null, createdById: null }
    ]

    const t = buildTree(folders, docs)

    expect(t.children.map(c => c.folder!.name)).toEqual(['API', 'Runbooks'])
    expect(t.docs.map(d => d.title)).toEqual(['Alpha', 'Lost', 'Zeta'])
    expect(t.children[1].children[0].docs.map(d => d.title)).toEqual(['Deploy'])
    expect([...descendants(folders, 'a')].sort()).toEqual(['a', 'b'])
  })
})
