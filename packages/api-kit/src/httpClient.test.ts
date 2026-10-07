import { describe, expect, it, vi } from 'vitest'

import { ApiError } from './errors'
import { buildUrl, createHttpClient } from './httpClient'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function client(fetchMock: ReturnType<typeof vi.fn>, extra: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  return createHttpClient({ baseUrl: 'https://api.test/v1/', fetch: fetchMock as unknown as typeof fetch, ...extra })
}

describe('buildUrl', () => {
  it('joins base and path with one slash and appends params', () => {
    expect(buildUrl('https://a/v1/', '/x', { page: 2, q: 'a b', skip: undefined, empty: '', tags: ['a', 'b'] })).toBe(
      'https://a/v1/x?page=2&q=a+b&tags=a&tags=b'
    )
  })

  it('keeps an existing query string and absolute URLs', () => {
    expect(buildUrl('https://a', '/x?y=1', { z: 2 })).toBe('https://a/x?y=1&z=2')
    expect(buildUrl('https://a', 'https://b/c')).toBe('https://b/c')
  })
})

describe('createHttpClient', () => {
  it('unwraps { success, data } and sends JSON with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: { id: 1 } }))
    const result = await client(fetchMock)<{ id: number }>({ url: '/x', method: 'POST', data: { a: 1 } })

    expect(result).toEqual({ id: 1 })
    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('https://api.test/v1/x')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.credentials).toBe('include')
  })

  it('returns paginated bodies (items/meta, no data) whole, and raw on request', async () => {
    const page = { success: true, items: [1], meta: { total: 1 } }
    const fetchMock = vi.fn().mockImplementation(async () => json(page))

    expect(await client(fetchMock)({ url: '/x', method: 'GET' })).toEqual(page)
    const withData = { success: true, data: [1], meta: { total: 9 } }

    fetchMock.mockImplementation(async () => json(withData))
    expect(await client(fetchMock)({ url: '/x', method: 'GET', raw: true })).toEqual(withData)
  })

  it('returns undefined for 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    expect(await client(fetchMock)({ url: '/x', method: 'DELETE' })).toBeUndefined()
  })

  it('passes FormData through without a JSON content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: true, data: null }))
    const form = new FormData()

    form.append('a', '1')
    await client(fetchMock)({ url: '/x', method: 'POST', data: form })
    const init = fetchMock.mock.calls[0][1]

    expect(init.body).toBe(form)
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('throws ApiError with code, field errors and requestId from the error envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(
        { success: false, code: 'VALIDATION_ERROR', message: 'Invalid request data', errors: [{ path: ['email'], message: 'Invalid email' }], requestId: 'r1' },
        400
      )
    )
    const err = await client(fetchMock)({ url: '/x', method: 'POST', data: {} }).catch(e => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.requestId).toBe('r1')
    expect(err.fieldError('email')).toBe('Invalid email')
    expect(err.isClientError).toBe(true)
  })

  it('treats a 200 with success:false as an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ success: false, message: 'nope' }))

    await expect(client(fetchMock)({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 200, message: 'nope' })
  })

  it('maps network failures to ApiError status 0', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    await expect(client(fetchMock)({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('attaches auth headers except for public requests', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({ success: true, data: 1 }))
    const c = client(fetchMock, { getAuthHeaders: async () => ({ Authorization: 'Bearer t' }) })

    await c({ url: '/a', method: 'GET' })
    await c({ url: '/b', method: 'GET', isPublic: true })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined()
  })

  it('calls onUnauthorized once on 401 and retries with fresh headers; a second 401 throws', async () => {
    let token = 'old'
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization === 'Bearer new' ? json({ success: true, data: 'ok' }) : json({ message: 'expired' }, 401)
    )
    const onUnauthorized = vi.fn(async <T>(retry: () => Promise<T>) => {
      token = 'new'

      return retry()
    })
    const c = client(fetchMock, { getAuthHeaders: () => ({ Authorization: `Bearer ${token}` }), onUnauthorized })

    expect(await c({ url: '/x', method: 'GET' })).toBe('ok')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)

    token = 'still-bad'
    const stubborn = client(vi.fn().mockImplementation(async () => json({ message: 'expired' }, 401)), {
      getAuthHeaders: () => ({ Authorization: 'Bearer x' }),
      onUnauthorized: async retry => retry()
    })

    await expect(stubborn({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 401 })
  })

  it('does not call onUnauthorized for public requests', async () => {
    const onUnauthorized = vi.fn()
    const c = client(vi.fn().mockResolvedValue(json({ message: 'bad' }, 401)), { onUnauthorized })

    await expect(c({ url: '/login', method: 'POST', data: {}, isPublic: true })).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('times out', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    const c = client(fetchMock, { timeoutMs: 10 })

    await expect(c({ url: '/x', method: 'GET' })).rejects.toMatchObject({ status: 0, code: 'TIMEOUT' })
  })

  it('a request can set its own timeout', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_u: string, init: RequestInit) => new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response(JSON.stringify({ data: 1 }), { headers: { 'content-type': 'application/json' } })), 40)

        init.signal!.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))))
      })
    )
    const c = client(fetchMock, { timeoutMs: 10 })

    await expect(c({ url: '/x', method: 'GET', timeoutMs: 1000 })).resolves.toBe(1)
    await expect(c({ url: '/x', method: 'GET', timeoutMs: 5 })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
