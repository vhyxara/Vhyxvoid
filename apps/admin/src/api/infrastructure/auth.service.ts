import type { AdminLoginResponse, AdminMe, AdminRefreshResponse } from '@/api/domain/auth/auth.types'
import { ADMIN_AUTH_ENDPOINTS } from './auth.endpoints'
import { httpClient } from '@/api/wrapper/http'
import { withCrossTabLock } from '@/api/wrapper/crossTabLock'

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

  // The refresh token is the httpOnly cookie; the browser attaches it. Held
  // under one lock across tabs so two tabs never present the same token at
  // the same moment (the api's 30 s rotation grace covers the rest).
  refresh: () =>
    withCrossTabLock('vhyxvoid-admin:refresh', () =>
      httpClient<AdminRefreshResponse>({
        url: ADMIN_AUTH_ENDPOINTS.REFRESH,
        method: 'POST',
        data: {},
        isPublic: true
      })
    ),

  logout: () =>
    httpClient<void>({
      url: ADMIN_AUTH_ENDPOINTS.LOGOUT,
      method: 'POST',
      data: {}
    }),

  me: () =>
    httpClient<AdminMe>({
      url: ADMIN_AUTH_ENDPOINTS.ME,
      method: 'GET'
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    httpClient<void>({
      url: '/admin/identity/me/password',
      method: 'POST',
      data
    })
}
