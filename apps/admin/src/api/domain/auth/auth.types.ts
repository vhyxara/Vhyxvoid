// Shapes matching apps/api's real admin-auth responses exactly, per
// internal-tools/admin-frontend/context.md's Part 1 route-reading pass —
// not apps/web's regular-user auth.types.ts (different fields: no
// `isEmailVerified`, has `isSuperAdmin`, no `passwordHash` leakage, etc.).

export type AdminUser = {
  id: string
  email: string
  fullName: string
  isSuperAdmin: boolean
}

// POST /api/v1/admin/identity/auth/login's real response body (AdminLoginUseCase.execute()).
export type AdminLoginResponse = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  admin: AdminUser
}

// POST /api/v1/admin/identity/auth/refresh's real response body, confirmed
// by reading AdminRefreshToken.usecase.ts directly. Important: the refresh
// token ROTATES on every call (old session revoked, new one issued, with
// reuse-detection that revokes ALL of an admin's sessions if a already-
// revoked token is presented again) -- the caller MUST persist the new
// `refreshToken` from this response, not just the new `accessToken`, or
// the next refresh attempt will look like reuse and nuke every session.
export type AdminRefreshResponse = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

// GET /api/v1/admin/identity/me's real response body.
export type AdminMe = {
  id: string
  email: string
  fullName: string
  isSuperAdmin: boolean
  status: boolean
}
