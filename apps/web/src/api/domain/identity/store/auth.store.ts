// domain/identity/store/auth.store.ts

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { AuthUser, LoginResponse } from '../types/auth.types'

type BootstrapStatus = 'idle' | 'loading' | 'done'

type AuthStore = {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
  bootstrapStatus: BootstrapStatus

  setTokens: (res: LoginResponse) => void
  setAccessToken: (token: string) => void
  clearSession: () => void
  setBootstrapStatus: (s: BootstrapStatus) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    set => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      bootstrapStatus: 'idle',

      setTokens: (res: LoginResponse) =>
        set({
          user: res.user,
          accessToken: res.accessToken,
          isAuthenticated: true
        }),

      setAccessToken: (token: string) => set({ accessToken: token }),

      clearSession: () =>
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false
        }),

      setBootstrapStatus: (bootstrapStatus: BootstrapStatus) => set({ bootstrapStatus })
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => sessionStorage),
      partialize: state => ({
        // user shape persisted so UserDropdown renders before bootstrap completes
        user: state.user,
        isAuthenticated: state.isAuthenticated

        // accessToken excluded — memory-only, restored by bootstrap
        // bootstrapStatus excluded — always resets to 'idle'
      })
    }
  )
)

export const getAccessToken = () => useAuthStore.getState().accessToken
export const clearSession = () => useAuthStore.getState().clearSession()
