import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { createQueryKeys } from './queryKeys'

describe('createQueryKeys', () => {
  const keys = createQueryKeys<{ page: number }>('things')

  it('builds hierarchical keys', () => {
    expect(keys.all).toEqual(['things'])
    expect(keys.lists()).toEqual(['things', 'list'])
    expect(keys.list({ page: 1 })).toEqual(['things', 'list', { page: 1 }])
    expect(keys.details()).toEqual(['things', 'detail'])
    expect(keys.detail('a')).toEqual(['things', 'detail', 'a'])
  })

  it('invalidating all matches lists and details through prefix matching', async () => {
    const qc = new QueryClient()

    qc.setQueryData(keys.list({ page: 1 }), 1)
    qc.setQueryData(keys.detail('a'), 2)
    await qc.invalidateQueries({ queryKey: keys.all })
    expect(qc.getQueryState(keys.list({ page: 1 }))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(keys.detail('a'))?.isInvalidated).toBe(true)
  })
})

describe('list() without params', () => {
  it('is the lists() key', () => {
    expect(createQueryKeys('x').list()).toEqual(['x', 'list'])
  })
})
