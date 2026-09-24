// import { httpClientConfig } from '@/api/wrapper/http'
import type { LoginResponse, AuthTokens, RegisterResponse } from '@/api/domain/identity/types/auth.types'
import { AUTH_ENDPOINTS } from '../endpoints/auth.endpoints'
import { httpClient } from '@/api/wrapper/http'
import { withCrossTabLock } from './crossTabLock'

export type RegisterDTO = {
  email: string
  password: string
  firstName?: string
  lastName?: string
}

export type LoginDTO = {
  email: string
  password: string
}

export const authService = {
  login: (data: LoginDTO) =>
    httpClient<LoginResponse>({
      url: AUTH_ENDPOINTS.LOGIN,
      method: 'POST',
      data,
      isPublic: true
    }),

  register: (data: RegisterDTO) =>
    httpClient<RegisterResponse>({
      url: AUTH_ENDPOINTS.REGISTER,
      method: 'POST',
      data,
      isPublic: true
    }),

  // Called by the 401 interceptor (http.ts) and the page-load bootstrap
  // (bootstrapSession.ts). Held under one lock across all tabs so they never
  // send the same refresh cookie at once (audit H10).
  refresh: () =>
    withCrossTabLock('vhyxvoid:auth-refresh', () =>
      httpClient<AuthTokens>({
        url: AUTH_ENDPOINTS.REFRESH,
        method: 'POST',
        data: {},
        isPublic: true
      })
    ),

  logout: () =>
    httpClient<void>({
      url: AUTH_ENDPOINTS.LOGOUT,
      method: 'POST',
      data: {}
    }),

  logoutAll: () =>
    httpClient<void>({
      url: AUTH_ENDPOINTS.LOGOUT_ALL,
      method: 'POST',
      data: {}
    }),

  verifyEmail: (token: string) =>
    httpClient<{ message: string }>({
      url: AUTH_ENDPOINTS.VERIFY_EMAIL,
      method: 'POST',
      data: { token },
      isPublic: true
    })
}
