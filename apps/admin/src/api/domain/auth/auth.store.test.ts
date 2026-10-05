import { beforeEach, describe, expect, it } from 'vitest'

import { useAdminAuthStore, getAdminAccessToken, clearAdminSession } from './auth.store'
import type { AdminLoginResponse } from './auth.types'

const LOGIN_RESPONSE: AdminLoginResponse = {
  accessToken: 'access-1',
  expiresIn: 900,
  admin: { id: 'admin-1', email: 'admin@company.local', fullName: 'Super Admin', isSuperAdmin: true }
}

describe('useAdminAuthStore', () => {
  beforeEach(() => {
    useAdminAuthStore.getState().clearSession()
    sessionStorage.clear()
  })

  it('setSession stores the access token and admin and marks the session authenticated', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)

    expect(getAdminAccessToken()).toBe('access-1')
    expect(useAdminAuthStore.getState().admin).toEqual(LOGIN_RESPONSE.admin)
    expect(useAdminAuthStore.getState().status).toBe('authenticated')
    expect(useAdminAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('setAccessToken rotates the token without touching the admin', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)
    useAdminAuthStore.getState().setAccessToken('access-2')

    expect(getAdminAccessToken()).toBe('access-2')
    expect(useAdminAuthStore.getState().admin).toEqual(LOGIN_RESPONSE.admin)
  })

  it('clearSession wipes everything and marks the session anonymous', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)
    clearAdminSession()

    const state = useAdminAuthStore.getState()

    expect(state.status).toBe('anonymous')
    expect(state.isAuthenticated).toBe(false)
    expect(state.accessToken).toBeNull()
    expect(state.admin).toBeNull()
  })

  it('never writes a token to storage: only the profile is persisted (audit M19)', () => {
    useAdminAuthStore.getState().setSession(LOGIN_RESPONSE)

    const raw = sessionStorage.getItem('admin-profile')

    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw!).state

    expect(persisted.admin.email).toBe('admin@company.local')
    expect(persisted.accessToken).toBeUndefined()
    expect(JSON.stringify(persisted)).not.toContain('access-1')
    expect(localStorage.getItem('admin-profile')).toBeNull()
  })
})
