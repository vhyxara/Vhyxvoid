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

// A refresh token presented again within this long after it was ROTATED gets
// the same successor back instead of triggering reuse detection: covers two
// tabs (or a retried request) refreshing with the same cookie at once. Past
// it, a rotated token is treated as stolen and every session is revoked.
// Audit H10.
export const REFRESH_ROTATION_GRACE_MS = 30 * 1000;

export const REFRESH_COOKIE_NAME = "refresh_token";

export const SIGNATURE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLOCK_SKEW_MS = 30 * 1000; // 30 seconds
