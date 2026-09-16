import type {
  ForgotPasswordPayload,
  ForgotPasswordResult,
  ResetPasswordPayload,
  ResetPasswordResult,
  ChangePasswordPayload,
  ChangePasswordResult
} from '@/api/domain/identity/types/auth.types'
import { httpClient } from '@/api/wrapper/http'
import { AUTH_ENDPOINTS } from '../endpoints/auth.endpoints'

export const passwordService = {
  /**
   * POST /auth/forgot-password
   * Public — always returns 200 regardless of whether email exists (anti-enumeration).
   */
  forgotPassword: (data: ForgotPasswordPayload): Promise<ForgotPasswordResult> =>
    httpClient({
      url: AUTH_ENDPOINTS.FORGOT_PASSWORD,
      method: 'POST',
      data
    }),

  /**
   * POST /auth/reset-password
   * Public — token comes from the email link query param.
   */
  resetPassword: (data: ResetPasswordPayload): Promise<ResetPasswordResult> =>
    httpClient({
      url: AUTH_ENDPOINTS.RESET_PASSWORD,
      method: 'POST',
      data
    }),

  /**
   * POST /account/me/password
   * Auth required — change password for the currently authenticated user.
   * Revokes all sessions after change — user will need to log in again.
   */
  changePassword: (data: ChangePasswordPayload): Promise<ChangePasswordResult> =>
    httpClient({
      url: AUTH_ENDPOINTS.CHANGE_PASSWORD,
      method: 'POST',
      data
    })
}
