import { describe, expect, it } from 'vitest'

import { prettyBody, statusVariant, toCurl } from './inspectorFormat'

const body = (data: string | null, extra: Partial<{ encoding: 'utf8' | 'base64'; size: number; truncated: boolean }> = {}) => ({
  data,
  encoding: data ? (extra.encoding ?? 'utf8') : null,
  size: extra.size ?? (data?.length ?? 0),
  truncated: extra.truncated ?? false
})

describe('prettyBody', () => {
  it('pretty-prints JSON', () => {
    expect(prettyBody(body('{"a":1}'), 'application/json')).toEqual({ text: '{\n  "a": 1\n}', kind: 'json' })
  })

  it('keeps truncated JSON as text and describes binary', () => {
    expect(prettyBody(body('{"a":', { truncated: true }), 'application/json').kind).toBe('text')
    expect(prettyBody(body('AAAA', { encoding: 'base64', size: 2048 })).text).toBe('Binary body, 2.0 KB')
  })

  it('splits form bodies', () => {
    expect(prettyBody(body('a=1&b=two'), 'application/x-www-form-urlencoded').text).toBe('a = 1\nb = two')
  })
})

describe('toCurl', () => {
  it('builds a command without hidden or hop headers', () => {
    const cmd = toCurl({
      id: 'req_1', at: '', label: 'api', accountSlug: 'acme', host: 'acme--api.vhyxvoid.com', method: 'POST', path: "/hook?x=1",
      clientIp: null, durationMs: 1, error: null, replayOf: null, response: null,
      request: { headers: { 'content-type': 'application/json', authorization: '[hidden]', host: 'x' }, body: body(`{"it's":1}`) }
    })

    expect(cmd).toContain("curl -X POST 'https://acme--api.vhyxvoid.com/hook?x=1'")
    expect(cmd).toContain("-H 'content-type: application/json'")
    expect(cmd).not.toContain('authorization')
    expect(cmd).toContain(`--data-raw '{"it'\\''s":1}'`)
  })
})

describe('statusVariant', () => {
  it('maps classes', () => {
    expect(statusVariant(200, null)).toBe('success')
    expect(statusVariant(404, null)).toBe('warning')
    expect(statusVariant(502, null)).toBe('danger')
    expect(statusVariant(null, 'AGENT_TIMEOUT')).toBe('danger')
  })
})
