export const TTL = {
  ACCESS_TOKEN_SEC: 6000 * 60, // 100 hours (for testing, can be reduced to 15 min in prod)
  REFRESH_TOKEN_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const;

export const AdminTTL = {
  ADMIN_TOKEN_TTL_SECONDS: 6000 * 60, // 100 hours (for testing, can be reduced to 15 min in prod)
  ADMIN_REFRESH_TOKEN_TTL_MS: 60 * 60 * 24 * 30 * 1000, // 30 days
} as const;

export const REFRESH_COOKIE_NAME = "refresh_token";

export const SIGNATURE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLOCK_SKEW_MS = 30 * 1000; // 30 seconds
