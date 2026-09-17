// domain/auth/auth.store.ts
//
// Deliberately NOT modeled on apps/web's auth.store.ts, per
// internal-tools/admin-frontend/decision.md's Part 3.3 finding: admin login
// has zero cookie involvement (no httpOnly refresh cookie to fall back on),
// so unlike apps/web -- which keeps `accessToken` memory-only and restores
// it via a silent refresh against the cookie on every page load -- this
// store must itself hold and persist BOTH tokens, or a page reload loses
// the session outright with no way to recover it.
//
// Persisted to sessionStorage (not localStorage), matching the one
// storage choice apps/web's own auth.store.ts already made for its
// (lower-stakes) persisted slice -- session-scoped, cleared when the tab/
// window closes, not indefinitely readable the way localStorage is. This
// is the established "don't reach for localStorage for auth-adjacent
// state" precedent in this codebase (internal-tools/user-frontend/context.md
// item 42), applied here since there's no cookie to lean on instead.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { AdminLoginResponse, AdminUser } from './auth.types'

type AuthStore = {
  admin: AdminUser | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean

  setSession: (res: AdminLoginResponse) => void
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void
  clearSession: () => void
}

export const useAdminAuthStore = create<AuthStore>()(
  persist(
    set => ({
      admin: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setSession: (res: AdminLoginResponse) =>
        set({
          admin: res.admin,
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          isAuthenticated: true
        }),

      // Called after a successful refresh -- rotates BOTH tokens (see
      // auth.types.ts's AdminRefreshResponse comment on why the refresh
      // token itself must be replaced too, not just the access token).
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),

      clearSession: () =>
        set({
          admin: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false
        })
    }),
    {
      name: 'admin-auth-store',
      storage: createJSONStorage(() => sessionStorage)
    }
  )
)

export const getAdminAccessToken = () => useAdminAuthStore.getState().accessToken
export const getAdminRefreshToken = () => useAdminAuthStore.getState().refreshToken
export const clearAdminSession = () => useAdminAuthStore.getState().clearSession()
