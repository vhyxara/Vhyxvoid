import type { AdminLoginResponse, AdminMe, AdminRefreshResponse } from '@/api/domain/auth/auth.types'
import { ADMIN_AUTH_ENDPOINTS } from './auth.endpoints'
import { httpClient } from '@/api/wrapper/http'

export type AdminLoginDTO = {
  email: string
  password: string
}

export const adminAuthService = {
  login: (data: AdminLoginDTO) =>
    httpClient<AdminLoginResponse>({
      url: ADMIN_AUTH_ENDPOINTS.LOGIN,
      method: 'POST',
      data,
      isPublic: true
    }),

  // Admin refresh has zero cookie involvement (see
  // internal-tools/admin-frontend/context.md's Part 1/Part 3.3) -- the raw
  // refresh token must be sent explicitly in the body, unlike apps/web's
  // equivalent call which relies entirely on the httpOnly cookie the
  // browser attaches automatically.
  refresh: (refreshToken: string) =>
    httpClient<AdminRefreshResponse>({
      url: ADMIN_AUTH_ENDPOINTS.REFRESH,
      method: 'POST',
      data: { refreshToken },
      isPublic: true
    }),

  // Logout also needs the raw refresh token in the body -- admin.routes.ts's
  // /auth/logout handler looks up the AdminSession by hashing the token it's
  // given, there being no cookie to read it from server-side either.
  logout: (refreshToken: string) =>
    httpClient<void>({
      url: ADMIN_AUTH_ENDPOINTS.LOGOUT,
      method: 'POST',
      data: { refreshToken }
    }),

  me: () =>
    httpClient<AdminMe>({
      url: ADMIN_AUTH_ENDPOINTS.ME,
      method: 'GET'
    })
}
