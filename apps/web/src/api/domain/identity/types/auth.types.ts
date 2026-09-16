export type AuthUser = {
  id: string
  email: string
  firstName?: string
  lastName?: string
}

/**
 * Returned by POST /auth/login and POST /auth/refresh.
 * refreshToken is NOT in the body — it travels as an httpOnly cookie.
 * The frontend never reads, stores, or forwards it manually.
 */
export type AuthTokens = {
  accessToken: string
  expiresIn: number
  user: AuthUser
}

// LoginResponse is identical — both endpoints return the same shape
export type LoginResponse = AuthTokens

export type RegisterResponse = {
  email: string
  requiresVerification: boolean
}

// What lives in Zustand — accessToken only, never refreshToken
export type SessionState = {
  user: AuthUser | null
  accessToken: string | null
  isAuthenticated: boolean
}

export type ForgotPasswordPayload = {
  email: string
}

export type ResetPasswordPayload = {
  token: string
  newPassword: string
}

export type ChangePasswordPayload = {
  currentPassword: string
  newPassword: string
}

export type ForgotPasswordResult = {
  message: string
}

export type ResetPasswordResult = {
  message: string
}

export type ChangePasswordResult = {
  message: string
}
