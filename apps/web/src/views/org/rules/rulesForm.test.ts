import { describe, expect, it } from 'vitest'

import { TEMPLATES, blankForm, formFromRule, parseHeaderLines, ruleFromCapture, ruleFromForm, summarize } from './rulesForm'

describe('rulesForm', () => {
  it('round-trips every template through the form unchanged', () => {
    for (const t of TEMPLATES) {
      const rule = t.make()

      expect(ruleFromForm(formFromRule(rule)), t.key).toEqual(rule)
    }
  })

  it('builds a mock from the form, dropping empty parts', () => {
    const f = { ...blankForm('mock'), path: '/api/x', methods: ['GET' as const], status: '201', headers: 'Content-Type: application/json\nnonsense line', body: '{}' }
    const r = ruleFromForm(f)

    expect(r.match).toEqual({ path: '/api/x', methods: ['GET'] })
    expect(r.action).toEqual({ type: 'mock', status: 201, headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(summarize(r)).toBe('GET /api/x → answer 201')
  })

  it('changing actions are never offline-only; header lists accept commas and lines', () => {
    const f = { ...blankForm('requestHeaders'), when: 'offline' as const, headers: 'X-Env: preview', remove: 'Cookie, X-Debug\nX-Other' }
    const r = ruleFromForm(f)

    expect(r.when).toBe('always')
    expect(r.action).toEqual({ type: 'requestHeaders', set: { 'X-Env': 'preview' }, remove: ['Cookie', 'X-Debug', 'X-Other'] })
  })

  it('header lines keep colons in values', () => {
    expect(parseHeaderLines('Location: https://a.dev:8443/x')).toEqual({ Location: 'https://a.dev:8443/x' })
  })

  it('a captured response becomes a mock for that method and path, without the query', () => {
    const r = ruleFromCapture({ method: 'post', path: '/hooks/stripe?x=1', status: 200, contentType: 'application/json', body: '{"received":true}' })

    expect(r.match).toEqual({ path: '/hooks/stripe', methods: ['POST'] })
    expect(r.action).toEqual({ type: 'mock', status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"received":true}' })
  })
})
