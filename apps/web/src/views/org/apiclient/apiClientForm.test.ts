import { describe, expect, it } from 'vitest'

import {
  applyUrlInput,
  bodyView,
  buildTree,
  convertBody,
  duplicateRequest,
  folderDescendants,
  formatBytes,
  formatMs,
  joinUrl,
  jsonProblem,
  newRequest,
  opsFor,
  splitUrl,
  suggestAssertions,
  timingSegments,
  undefinedVars
} from './apiClientForm'

describe('apiClientForm', () => {
  it('splits and joins URLs, keeping {{vars}} and disabled params', () => {
    expect(splitUrl('{{baseUrl}}/users?page=2&q=a%20b&flag')).toEqual({ base: '{{baseUrl}}/users', params: [{ key: 'page', value: '2', enabled: true }, { key: 'q', value: 'a b', enabled: true }, { key: 'flag', value: '', enabled: true }] })
    expect(joinUrl('{{baseUrl}}/users', [{ key: 'q', value: 'a b', enabled: true }, { key: 'off', value: '1', enabled: false }, { key: 'id', value: '{{id}}', enabled: true }])).toBe('{{baseUrl}}/users?q=a%20b&id={{id}}')
    const r = newRequest({ params: [{ key: 'keep', value: '1', enabled: false }] })

    expect(applyUrlInput(r, 'https://x.test/a?b=1')).toEqual({ url: 'https://x.test/a', params: [{ key: 'b', value: '1', enabled: true }, { key: 'keep', value: '1', enabled: false }] })
  })

  it('finds undefined variables across the request', () => {
    const r = newRequest({ url: '{{baseUrl}}/u/{{id}}', headers: [{ key: 'X', value: '{{trace}}', enabled: true }, { key: 'Y', value: '{{off}}', enabled: false }], auth: { type: 'bearer', token: '{{token}}' }, body: { type: 'json', text: '{"id":"{{$uuid}}"}' } })

    expect(undefinedVars(r, new Set(['baseUrl', 'token']))).toEqual(['id', 'trace'])
  })

  it('converts bodies keeping text or fields', () => {
    expect(convertBody({ type: 'json', text: '{"a":1}' }, 'raw')).toEqual({ type: 'raw', text: '{"a":1}', contentType: 'text/plain' })
    expect(convertBody({ type: 'form', fields: [{ key: 'a', value: '1', enabled: true }] }, 'multipart')).toEqual({ type: 'multipart', fields: [{ key: 'a', value: '1', enabled: true }] })
    expect(jsonProblem('{"a":')).toBeTruthy()
    expect(jsonProblem('{"a": {{num}}}')).toBeNull()
  })

  it('offers operators that fit the source and suggests checks from a response', () => {
    expect(opsFor('status')).not.toContain('contains')
    expect(opsFor('json')).toContain('schema')
    const s = suggestAssertions({ status: 201, statusText: '', headers: [['Content-Type', 'application/json; charset=utf-8']], body: '{"id":1,"name":"x"}', bodyEncoding: 'utf8', size: 10, truncated: false, timings: { dns: 0, connect: 0, tls: 0, firstByte: 40, download: 1, total: 45 } })

    expect(s.map(a => `${a.source} ${a.path ?? ''} ${a.op} ${a.value ?? ''}`.replace(/\s+/g, ' ').trim())).toEqual(['status eq 201', 'header content-type contains application/json', 'time lt 200', 'json $.id exists', 'json $.name exists'])
  })

  it('formats sizes, times and the timing waterfall', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatMs(0.4)).toBe('<1 ms')
    expect(formatMs(1500)).toBe('1.50 s')
    expect(timingSegments({ dns: 5, connect: 10, tls: 20, firstByte: 100, download: 3, total: 138 }).map(s => s.offset)).toEqual([0, 5, 15, 35, 135])
  })

  it('shows bodies as pretty JSON, images or a binary note', () => {
    expect(bodyView({ body: '{"a":1}', bodyEncoding: 'utf8', headers: [], size: 7 })).toEqual({ kind: 'json', text: '{\n  "a": 1\n}' })
    expect(bodyView({ body: 'AA==', bodyEncoding: 'base64', headers: [['content-type', 'image/png']], size: 1 }).kind).toBe('image')
    expect(bodyView({ body: 'AA==', bodyEncoding: 'base64', headers: [['content-type', 'application/pdf']], size: 2048 })).toEqual({ kind: 'binary', text: '2.0 KB of application/pdf' })
  })

  it('builds the tree, filters it, and duplicates requests with new ids', () => {
    const folders = [{ id: 'f1', name: 'Users' }, { id: 'f2', name: 'Admin', parentId: 'f1' }]
    const reqs = [newRequest({ name: 'List', folderId: 'f1' }), newRequest({ name: 'Ban', folderId: 'f2' }), newRequest({ name: 'Health' }), newRequest({ name: 'Orphan', folderId: 'gone' })]
    const tree = buildTree(folders, reqs)

    expect(tree.map(n => (n.kind === 'folder' ? n.folder.name : n.request.name))).toEqual(['Health', 'Orphan', 'Users'])
    expect(buildTree(folders, reqs, 'ban').map(n => (n.kind === 'folder' ? n.folder.name : n.request.name))).toEqual(['Users'])
    expect([...folderDescendants(folders, 'f1')]).toEqual(['f1', 'f2'])
    const d = duplicateRequest(reqs[0])

    expect(d.id).not.toBe(reqs[0].id)
    expect(d.assertions[0].id).not.toBe(reqs[0].assertions[0].id)
    expect(d.name).toBe('List copy')
  })
})
