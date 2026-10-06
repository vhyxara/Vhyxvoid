import { describe, expect, it } from 'vitest'

import {
  bodyWarning,
  curlFor,
  describeRule,
  duplicateEndpoint,
  exampleUrl,
  formatBody,
  headersToRows,
  labelFromName,
  LABEL_RE,
  moveItem,
  newEndpoint,
  pathParams,
  pathProblem,
  rowsToHeaders,
  setDefault
} from './mockForm'

describe('mockForm', () => {
  it('new endpoints get a free path and one default response', () => {
    const a = newEndpoint([])
    const b = newEndpoint([a])

    expect(a.path).toBe('/new')
    expect(b.path).toBe('/new-2')
    expect(a.responses).toHaveLength(1)
    expect(a.responses[0].isDefault).toBe(true)
  })

  it('duplicates with fresh ids and no shared objects', () => {
    const a = newEndpoint([], { name: 'Users' })
    const b = duplicateEndpoint(a)

    expect(b.id).not.toBe(a.id)
    expect(b.responses[0].id).not.toBe(a.responses[0].id)
    expect(b.name).toBe('Users (copy)')
    b.responses[0].headers!.x = '1'
    expect(a.responses[0].headers!.x).toBeUndefined()
  })

  it('moves items and ignores moves past the ends', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
  })

  it('formats JSON and reports what is wrong', () => {
    expect(formatBody('{"a":1}').body).toBe('{\n  "a": 1\n}')
    expect(formatBody('{a}').error).toBeTruthy()
    expect(bodyWarning({ body: '{a}', headers: { 'Content-Type': 'application/json' } })).toMatch(/Not valid JSON/)
    expect(bodyWarning({ body: '{a}', templating: true, headers: { 'content-type': 'application/json' } })).toBeNull()
    expect(bodyWarning({ body: 'hi', headers: { 'content-type': 'text/plain' } })).toBeNull()
  })

  it('checks paths and finds their params', () => {
    expect(pathProblem('users')).toBe('Start with /')
    expect(pathProblem('/a b')).toBeTruthy()
    expect(pathProblem('/users/:id')).toBeNull()
    expect(pathParams('/users/:id/posts/{postId}/*')).toEqual(['id', 'postId'])
  })

  it('header rows round-trip, dropping empty names', () => {
    const rows = headersToRows({ a: '1' })

    expect(rowsToHeaders([...rows, { key: ' ', value: 'x' }, { key: ' b ', value: '2' }])).toEqual({ a: '1', b: '2' })
  })

  it('one default response', () => {
    const e = newEndpoint([])
    const two = [...e.responses, { ...e.responses[0], id: 'x', isDefault: false }]

    expect(setDefault(two, 'x').map(r => r.isDefault)).toEqual([false, true])
  })

  it('example URL and curl fill params', () => {
    expect(exampleUrl('https://acme--api.vhyxvoid.com', { path: '/users/:id/files/*' })).toBe('https://acme--api.vhyxvoid.com/users/1/files/example')
    expect(curlFor('https://h', { path: '/users', method: 'POST' })).toBe(`curl -i -X POST 'https://h/users' -H 'content-type: application/json' -d '{}'`)
    expect(curlFor(null, { path: '/x', method: 'GET' })).toBeNull()
  })

  it('describes rules and makes labels from names', () => {
    expect(describeRule({ source: 'param', key: 'id', op: 'equals', value: '0' })).toBe('path parameter id equals “0”')
    expect(describeRule({ source: 'header', key: 'authorization', op: 'not_exists' })).toBe('header authorization is missing')
    expect(labelFromName('Payments API v2!')).toBe('payments-api-v2')
    expect(LABEL_RE.test(labelFromName('  --Hello__World--  '))).toBe(true)
  })
})

describe('engine parity', () => {
  it('fallback response matches the engine: default, else first without rules, else first', async () => {
    const { fallbackResponse, examplePath } = await import('./mockForm')
    const rule = [{ source: 'query' as const, key: 'a', op: 'exists' as const }]

    expect(fallbackResponse([{ id: 'a', status: 200, rules: rule }, { id: 'b', status: 200 }])?.id).toBe('b')
    expect(fallbackResponse([{ id: 'a', status: 200 }, { id: 'b', status: 200, isDefault: true }])?.id).toBe('b')
    expect(fallbackResponse([{ id: 'a', status: 200, rules: rule }])?.id).toBe('a')
    expect(examplePath({ path: '/users/{id}' })).toBe('/users/1')
  })
})

describe('resources', () => {
  it('new resources get a free path; routes and seed parsing', async () => {
    const { newResource, resourceRoutes, parseSeed, RESOURCE_PATH_RE } = await import('./mockForm')
    const a = newResource([])
    const b = newResource([a])

    expect(a.path).toBe('/users')
    expect(b.path).not.toBe('/users')
    expect(resourceRoutes({ path: '/users', idField: 'uid' }).map(r => `${r.method} ${r.path}`)).toContain('PATCH /users/:uid')
    expect(parseSeed('[{"id":1}]')).toEqual({ seed: [{ id: 1 }] })
    expect(parseSeed('{"id":1}')).toEqual({ error: expect.stringMatching(/JSON list/) })
    expect(parseSeed('[1]')).toEqual({ error: expect.stringMatching(/object/) })
    expect(parseSeed('[')).toEqual({ error: expect.stringMatching(/Not valid JSON/) })
    expect(RESOURCE_PATH_RE.test('/api/v1/orders')).toBe(true)
    expect(RESOURCE_PATH_RE.test('/users/:id')).toBe(false)
  })
})
