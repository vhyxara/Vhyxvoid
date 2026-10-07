import { describe, expect, it } from 'vitest'

import {
  addOperation,
  buildTryPath,
  flatten,
  formParams,
  joinUrl,
  listOperations,
  problemKeys,
  problemLine,
  removeOperation,
  schemaLabel,
  schemaRows,
  setInfo,
  setParams,
  setResponses,
  setServers,
  updateOperation
} from './specForm'

const doc = {
  openapi: '3.0.3',
  info: { title: 'Shop', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        summary: 'List',
        parameters: [
          { $ref: '#/components/parameters/Limit' },
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 50 } }
        ],
        responses: { 200: { description: 'ok', content: {} } }
      }
    },
    '/users/{id}': {
      get: { summary: 'One', responses: { 200: { description: 'ok' } } },
      delete: { responses: { 204: { description: 'gone' } } }
    }
  }
}

describe('schemas', () => {
  const user = {
    'x-ref': 'User',
    allOf: [
      { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Full name' } } },
      {
        properties: {
          id: { type: 'integer', format: 'int64', readOnly: true },
          role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
          tags: { type: 'array', items: { type: 'string' } },
          team: { type: 'object', properties: { slug: { type: 'string' } } }
        }
      }
    ]
  }

  it('labels types, formats, arrays, refs and unions', () => {
    expect(schemaLabel({ type: 'string', format: 'email' })).toBe('string (email)')
    expect(schemaLabel({ type: 'array', items: user })).toBe('array of User')
    expect(schemaLabel({ $ref: '#/components/schemas/Node', title: 'Node' })).toBe('Node')
    expect(schemaLabel({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('one of: string | integer')
    expect(schemaLabel(undefined)).toBe('any')
    expect(flatten(user).type).toBe('object')
  })

  it('flattens allOf into one property table with nested rows and constraints', () => {
    const rows = schemaRows(user)

    expect(rows.map(r => `${'  '.repeat(r.depth)}${r.name}`)).toEqual(['name', 'id', 'role', 'tags', 'team', '  slug'])
    expect(rows[0]).toMatchObject({ required: true, type: 'string', description: 'Full name' })
    expect(rows[1]).toMatchObject({ type: 'integer (int64)', extra: ['read-only'] })
    expect(rows[2].extra).toEqual(['one of "admin", "member"', 'default "member"'])
    expect(
      schemaRows({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }).map(r => r.name)
    ).toEqual(['a'])
  })
})

describe('try it', () => {
  it('fills path parameters, encodes them, drops empty query values', () => {
    expect(
      buildTryPath('/users/{id}/posts/{postId}', {
        pathValues: { id: 'a b', postId: '7' },
        query: [
          ['limit', '10'],
          ['q', '']
        ]
      })
    ).toEqual({ path: '/users/a%20b/posts/7?limit=10', missing: [] })
    expect(buildTryPath('/users/{id}', { pathValues: {}, query: [] })).toEqual({ path: '/users/{id}', missing: ['id'] })
    expect(joinUrl('https://api.example.com/v1/', '/users')).toBe('https://api.example.com/v1/users')
  })
})

describe('form edits', () => {
  it('lists, adds and removes operations without touching the original', () => {
    expect(listOperations(doc).map(o => `${o.method} ${o.path}`)).toEqual([
      'get /users',
      'get /users/{id}',
      'delete /users/{id}'
    ])
    const added = addOperation(doc, { path: '/teams/{teamId}/members', method: 'post' })

    expect(added.paths['/teams/{teamId}/members'].post).toMatchObject({
      parameters: [{ name: 'teamId', in: 'path', required: true }],
      responses: { 201: { description: 'OK' } }
    })
    expect((doc.paths as Record<string, unknown>)['/teams/{teamId}/members']).toBeUndefined()
    expect(() => addOperation(doc, { path: '/users', method: 'get' })).toThrow(/already exists/)
    const removed = removeOperation(removeOperation(doc, { path: '/users/{id}', method: 'get' }), {
      path: '/users/{id}',
      method: 'delete'
    })

    expect(removed.paths['/users/{id}']).toBeUndefined()
  })

  it('edits fields, parameters (keeping $refs and schema details) and responses', () => {
    const u = updateOperation(
      doc,
      { path: '/users', method: 'get' },
      { summary: 'List users', deprecated: true, description: '' }
    )

    expect(u.paths['/users'].get).toMatchObject({ summary: 'List users', deprecated: true })
    expect(formParams(u, { path: '/users', method: 'get' })).toEqual([
      { name: 'q', in: 'query', required: false, type: 'string', description: '' }
    ])
    const p = setParams(u, { path: '/users', method: 'get' }, [
      { name: 'q', in: 'query', required: true, type: 'string', description: 'Search' },
      { name: 'X-Trace', in: 'header', required: false, type: 'string', description: '' },
      { name: '', in: 'query', required: false, type: 'string', description: '' }
    ])

    expect(p.paths['/users'].get.parameters).toEqual([
      { $ref: '#/components/parameters/Limit' },
      { name: 'q', in: 'query', required: true, description: 'Search', schema: { type: 'string', maxLength: 50 } },
      { name: 'X-Trace', in: 'header', schema: { type: 'string' } }
    ])
    const r = setResponses(p, { path: '/users', method: 'get' }, [
      { code: '200', description: 'The users' },
      { code: '429', description: '' }
    ])

    expect(r.paths['/users'].get.responses).toEqual({
      200: { description: 'The users', content: {} },
      429: { description: 'Response' }
    })
    expect(setInfo(doc, { title: 'Shop 2', version: '2', description: '' }).info).toEqual({
      title: 'Shop 2',
      version: '2'
    })
    expect(
      setServers(doc, [
        { url: ' https://a.dev ', description: '' },
        { url: '', description: 'x' }
      ]).servers
    ).toEqual([{ url: 'https://a.dev' }])
    expect(setServers({ servers: [{ url: 'x' }] }, []).servers).toBeUndefined()
  })
})

describe('problem lines', () => {
  const yaml = [
    'openapi: 3.0.3',
    'info:',
    '  title: Shop',
    'paths:',
    '  /v1.0/users/{id}:',
    '    get:',
    '      parameters:',
    '        - name: id',
    '          in: path',
    '      responses:',
    "        '600':",
    '          description: x',
    'components:',
    '  schemas:',
    '    Bad:',
    '      type: text'
  ].join('\n')

  it('splits locations, keeping dots inside path keys', () => {
    expect(problemKeys('paths./v1.0/users/{id}.get.parameters[0]')).toEqual([
      'paths',
      '/v1.0/users/{id}',
      'get',
      'parameters'
    ])
    expect(problemKeys('components.schemas.Bad.type')).toEqual(['components', 'schemas', 'Bad', 'type'])
  })

  it('finds the line in YAML and JSON, or the parser’s line', () => {
    expect(problemLine(yaml, 'paths./v1.0/users/{id}.get.parameters[0]')).toBe(7)
    expect(problemLine(yaml, 'paths./v1.0/users/{id}.get.responses.600')).toBe(11)
    expect(problemLine(yaml, 'components.schemas.Bad.type')).toBe(16)
    expect(problemLine(yaml, 'info.title')).toBe(3)
    expect(problemLine(yaml, 'line 4')).toBe(4)
    expect(problemLine(yaml, 'servers')).toBeNull()
    expect(problemLine(JSON.stringify({ info: { title: '' } }, null, 2), 'info.title')).toBe(3)
  })
})
