import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { httpClient } from './http'

// httpClient and useAdminAuthStore are imported statically (once, at file
// load) deliberately -- http.ts reaches auth.store.ts via a dynamic
// `import()` internally (to avoid a circular-import cycle, see that file's
// own comment), and if this test file used `vi.resetModules()` + a
// per-test dynamic `import('./http')`, that dynamic import would resolve
// to a DIFFERENT auth.store.ts module instance than the one held by this
// file's own static import -- assertions against `useAdminAuthStore`
// would then silently observe the wrong singleton. Static imports here
// keep everything on one real module instance for the whole file, which
// is also enough: the only real cross-test state (`isRefreshing`/
// `failedQueue` inside http.ts) already resets itself after every fully-
// awaited call (see http.ts's own `finally`/`processQueue`), so nothing
// needs forcing back to a clean slate beyond the auth store, which
// beforeEach already clears.

// Tests apps/admin's OWN auth wiring (getAuthHeaders / onUnauthorized in
// this file), not @vhyx/api-kit's generic transport mechanics -- those are
// already covered by that package's own httpClient.test.ts. This is real
// coverage apps/web's equivalent http.ts never had (grepped apps/web/src/api
// for a matching test file -- none exists), per this session's explicit
// "real test coverage from day one" instruction.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('apps/admin http.ts wiring', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let replaceMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    useAdminAuthStore.getState().clearSession()
    sessionStorage.clear()

    // jsdom's real window.location.replace throws "Not implemented" --
    // stub it so hardLogout()'s redirect doesn't blow up the test, and so
    // it can be asserted on.
    replaceMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace: replaceMock },
      writable: true
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAuthHeaders attaches Authorization from the store when an access token exists', async () => {
    useAdminAuthStore.getState().setSession({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 360000,
      admin: { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
    })
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }))


    await httpClient({ url: '/admin/identity/me', method: 'GET' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer access-1')
  })

  it('sends no Authorization header when the store has no access token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }))


    await httpClient({ url: '/admin/identity/me', method: 'GET' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('on a 401, refreshes using the stored refresh token, persists BOTH rotated tokens, and retries with the new access token', async () => {
    useAdminAuthStore.getState().setSession({
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      expiresIn: 360000,
      admin: { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
    })

    let call = 0
    fetchMock.mockImplementation(async (_url: string, init: any) => {
      call += 1
      if (call === 1) return jsonResponse({ success: false, message: 'Invalid or expired access token' }, 401)
      if (init.body === JSON.stringify({ refreshToken: 'refresh-1' })) {
        return jsonResponse({
          success: true,
          data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 360000 }
        })
      }
      return jsonResponse({ success: true, data: { id: 'a1' } })
    })


    const result = await httpClient<{ id: string }>({ url: '/admin/identity/me', method: 'GET' })

    expect(result).toEqual({ id: 'a1' })
    expect(fetchMock).toHaveBeenCalledTimes(3) // original (401) -> refresh -> retry

    const state = useAdminAuthStore.getState()
    // Both tokens must be the NEW ones -- AdminRefreshToken.usecase.ts
    // rotates the refresh token too (reuse-detection revokes everything
    // if the OLD one is presented again), so persisting only the new
    // access token would silently break the next refresh.
    expect(state.accessToken).toBe('new-access')
    expect(state.refreshToken).toBe('new-refresh')

    const retryCall = fetchMock.mock.calls[2]
    expect(retryCall[1].headers.Authorization).toBe('Bearer new-access')
  })

  it('concurrent 401s during one in-flight refresh share a single refresh call', async () => {
    useAdminAuthStore.getState().setSession({
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      expiresIn: 360000,
      admin: { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
    })

    let refreshCalls = 0

    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (init.body && JSON.parse(init.body).refreshToken === 'refresh-1' && url.includes('/refresh')) {
        refreshCalls += 1
        return jsonResponse({
          success: true,
          data: { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 360000 }
        })
      }
      if (init.headers.Authorization === 'Bearer expired-access') {
        return jsonResponse({ success: false, message: 'expired' }, 401)
      }
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

  it('hard-logs-out (clears session, redirects to /login) when refresh itself fails', async () => {
    useAdminAuthStore.getState().setSession({
      accessToken: 'expired-access',
      refreshToken: 'revoked-refresh',
      expiresIn: 360000,
      admin: { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
    })

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/refresh')) {
        return jsonResponse({ success: false, message: 'Refresh token reuse detected. All sessions revoked.' }, 401)
      }
      return jsonResponse({ success: false, message: 'expired' }, 401)
    })


    await expect(httpClient({ url: '/admin/identity/me', method: 'GET' })).rejects.toBeTruthy()

    const state = useAdminAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })

  it('hard-logs-out immediately, with no network refresh attempt, when there is no refresh token to use', async () => {
    // Authenticated in shape but somehow missing a refresh token -- a
    // defensive case, not a real reachable state via setSession, but
    // worth guarding since sessionStorage could be hand-edited/corrupted.
    useAdminAuthStore.setState({
      accessToken: 'expired-access',
      refreshToken: null,
      admin: { id: 'a1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true },
      isAuthenticated: true
    })

    fetchMock.mockResolvedValue(jsonResponse({ success: false, message: 'expired' }, 401))


    await expect(httpClient({ url: '/admin/identity/me', method: 'GET' })).rejects.toBeTruthy()

    // Only the original 401'd request -- never a call to /refresh.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })
})
