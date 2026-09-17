import { beforeEach, describe, expect, it } from 'vitest'

import { useAdminAuthStore, getAdminAccessToken, getAdminRefreshToken, clearAdminSession } from './auth.store'
import type { AdminLoginResponse } from './auth.types'

const LOGIN_RESPONSE: AdminLoginResponse = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 360000,
  admin: { id: 'admin-1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
}

describe('useAdminAuthStore', () => {
  beforeEach(() => {
    useAdminAuthStore.getState().clearSession()
    sessionStorage.clear()
  })

  it('starts unauthenticated with no tokens', () => {
    const state = useAdminAuthStore.getState()

    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(state.admin).toBeNull()
  })

  it('setSession stores both tokens and the admin, and flips isAuthenticated', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)

    expect(getAdminAccessToken()).toBe('access-1')
    expect(getAdminRefreshToken()).toBe('refresh-1')
    expect(useAdminAuthStore.getState().admin).toEqual(LOGIN_RESPONSE.admin)
    expect(useAdminAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('setTokens rotates BOTH access and refresh tokens without touching admin/isAuthenticated', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)
    useAdminAuthStore.getState().setTokens({ accessToken: 'access-2', refreshToken: 'refresh-2' })

    const state = useAdminAuthStore.getState()

    expect(state.accessToken).toBe('access-2')
    expect(state.refreshToken).toBe('refresh-2')
    // A rotation is not a fresh login -- admin identity and auth flag survive.
    expect(state.admin).toEqual(LOGIN_RESPONSE.admin)
    expect(state.isAuthenticated).toBe(true)
  })

  it('clearSession wipes everything back to the unauthenticated state', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)
    clearAdminSession()

    const state = useAdminAuthStore.getState()

    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.refreshToken).toBeNull()
    expect(state.admin).toBeNull()
  })

  it('persists to sessionStorage (not localStorage) under its own key', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)

    const raw = sessionStorage.getItem('admin-auth-store')

    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).state.accessToken).toBe('access-1')
    expect(localStorage.getItem('admin-auth-store')).toBeNull()
  })
})
