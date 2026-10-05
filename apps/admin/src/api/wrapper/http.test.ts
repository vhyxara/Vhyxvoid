import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { httpClient } from './http'

// apps/admin's auth wiring: the access token comes from the in-memory store;
// on a 401 the client refreshes through the httpOnly cookie (no token in the
// body), shares one refresh across concurrent 401s, retries, and signs out
// when the refresh itself fails.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ADMIN = { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }

describe('apps/admin http.ts wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let replaceMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    useAdminAuthStore.getState().clearSession()
    sessionStorage.clear()
    replaceMock = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, replace: replaceMock }, writable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches Authorization from the store, and sends cookies', async () => {
    useAdminAuthStore.getState().setSession({ accessToken: 'access-1', admin: ADMIN })
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }))

    await httpClient({ url: '/admin/identity/me', method: 'GET' })

    const [, init] = fetchMock.mock.calls[0]

    expect(init.headers.Authorization).toBe('Bearer access-1')
    expect(init.credentials).toBe('include')
  })

  it('on a 401, refreshes with the cookie (empty body), stores the new access token and retries', async () => {
    useAdminAuthStore.getState().setSession({ accessToken: 'expired', admin: ADMIN })
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url.includes('/auth/refresh')) return jsonResponse({ success: true, data: { accessToken: 'new-access', expiresIn: 900 } })
      if (init.headers.Authorization === 'Bearer expired') return jsonResponse({ success: false, message: 'expired' }, 401)

      return jsonResponse({ success: true, data: { id: 'a1' } })
    })

    const result = await httpClient<{ id: string }>({ url: '/admin/identity/me', method: 'GET' })

    expect(result).toEqual({ id: 'a1' })
    const refreshCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/auth/refresh'))!

    expect(refreshCall[1].body).toBe('{}')
    expect(refreshCall[1].credentials).toBe('include')
    expect(useAdminAuthStore.getState().accessToken).toBe('new-access')
  })

  it('concurrent 401s share a single refresh call', async () => {
    useAdminAuthStore.getState().setSession({ accessToken: 'expired', admin: ADMIN })
    let refreshCalls = 0

    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1

        return jsonResponse({ success: true, data: { accessToken: 'new-access', expiresIn: 900 } })
      }
      if (init.headers.Authorization === 'Bearer expired') return jsonResponse({ success: false, message: 'expired' }, 401)

      return jsonResponse({ success: true, data: { ok: true } })
    })

    const [a, b] = await Promise.all([
      httpClient({ url: '/admin/identity/me', method: 'GET' }),
      httpClient({ url: '/admin/identity/me/abilities', method: 'GET' })
    ])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
  })

  it('signs out and redirects to /login when the refresh itself fails', async () => {
    useAdminAuthStore.getState().setSession({ accessToken: 'expired', admin: ADMIN })
    fetchMock.mockImplementation(async () => jsonResponse({ success: false, message: 'nope' }, 401))

    await expect(httpClient({ url: '/admin/identity/me', method: 'GET' })).rejects.toBeTruthy()

    const state = useAdminAuthStore.getState()

    expect(state.status).toBe('anonymous')
    expect(state.accessToken).toBeNull()
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })
})
