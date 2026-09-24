export const TTL = {
  // 15 min: user and admin access tokens, from login AND refresh (refresh
  // used to hard-code its own 15 min while login issued 100 h). Revocation is
  // immediate regardless (AuthStateCache); this bounds a stolen token. Audit H2.
  ACCESS_TOKEN_SEC: 15 * 60,
  REFRESH_TOKEN_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const;

export const AdminTTL = {
  ADMIN_TOKEN_TTL_SECONDS: 15 * 60, // see TTL.ACCESS_TOKEN_SEC
  ADMIN_REFRESH_TOKEN_TTL_MS: 60 * 60 * 24 * 30 * 1000, // 30 days
} as const;

export const REFRESH_COOKIE_NAME = "refresh_token";

export const SIGNATURE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLOCK_SKEW_MS = 30 * 1000; // 30 seconds
