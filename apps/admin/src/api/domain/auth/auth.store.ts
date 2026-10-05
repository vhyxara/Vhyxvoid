// domain/auth/auth.store.ts
//
// The admin session. The access token (15 min) lives in memory only; the
// refresh token is an httpOnly cookie the browser holds and JS never sees
// (api: admin.routes.ts, audit M19). A page load therefore starts
// `unknown` and AdminAuthGuard bootstraps it with one refresh call.
// Only the non-secret profile is kept in sessionStorage, so the shell can
// render the admin's name immediately on reload.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { AdminUser } from './auth.types'

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

type AuthStore = {
  admin: AdminUser | null
  accessToken: string | null
  status: SessionStatus
  /** Kept for existing callers: true once a session is established. */
  isAuthenticated: boolean

  setSession: (res: { accessToken: string; admin: AdminUser }) => void
  setAccessToken: (accessToken: string) => void
  setAdmin: (admin: AdminUser) => void
  /** Back-compat alias used by the 401 handler. */
  setTokens: (tokens: { accessToken: string }) => void
  clearSession: () => void
}

export const useAdminAuthStore = create<AuthStore>()(
  persist(
    set => ({
      admin: null,
      accessToken: null,
      status: 'unknown',
      isAuthenticated: false,

      setSession: ({ accessToken, admin }) => set({ admin, accessToken, status: 'authenticated', isAuthenticated: true }),
      setAccessToken: accessToken => set({ accessToken, status: 'authenticated', isAuthenticated: true }),
      setAdmin: admin => set({ admin }),
      setTokens: ({ accessToken }) => set({ accessToken, status: 'authenticated', isAuthenticated: true }),
      clearSession: () => set({ admin: null, accessToken: null, status: 'anonymous', isAuthenticated: false })
    }),
    {
      name: 'admin-profile',
      storage: createJSONStorage(() => sessionStorage),
      // Never persist the token or the session state.
      partialize: state => ({ admin: state.admin })
    }
  )
)

export const getAdminAccessToken = () => useAdminAuthStore.getState().accessToken
export const clearAdminSession = () => useAdminAuthStore.getState().clearSession()
