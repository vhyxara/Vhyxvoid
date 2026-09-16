import { describe, expect, it } from 'vitest'

import { cleanTableParams } from './tableUtility'

describe('cleanTableParams', () => {
  it('drops undefined and empty-string top-level entries', () => {
    expect(cleanTableParams({ page: 1, limit: 10, search: '', sortBy: undefined, sortOrder: undefined })).toEqual({
      page: 1,
      limit: 10
    })
  })

  it('keeps defined, non-empty entries untouched, including nested objects', () => {
    const params = { page: 2, limit: 20, search: 'alice', sortBy: 'name', sortOrder: 'asc', filters: { role: '2' } }

    expect(cleanTableParams(params)).toEqual(params)
  })
})
