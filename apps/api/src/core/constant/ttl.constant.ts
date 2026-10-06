export const TTL = {
  // 15 min: user and admin access tokens, from login AND refresh (refresh
  // used to hard-code its own 15 min while login issued 100 h). Revocation is
  // immediate regardless (AuthStateCache); this bounds a stolen token. Audit H2.
  ACCESS_TOKEN_SEC: 15 * 60,
  REFRESH_TOKEN_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  // Rotation slides a session forward 30 days at a time, but never past this
  // long after the sign-in that started it: then the user signs in again.
  // Audit M23.
  SESSION_ABSOLUTE_MS: 90 * 24 * 60 * 60 * 1000, // 90 days
} as const;

export const AdminTTL = {
  ADMIN_TOKEN_TTL_SECONDS: 15 * 60, // see TTL.ACCESS_TOKEN_SEC
  ADMIN_REFRESH_TOKEN_TTL_MS: 60 * 60 * 24 * 30 * 1000, // 30 days
  ADMIN_SESSION_ABSOLUTE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days, then sign in again (M23)
  // Failed admin sign-ins before the account is locked, and for how long (same scheme as users).
  ADMIN_MAX_FAILED_LOGINS: 5,
  ADMIN_LOCKOUT_MS: 15 * 60 * 1000,
} as const;

// Revoked or expired session rows are deleted this long after they stop
// being usable (kept a little for reuse detection and support questions).
export const SESSION_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// A refresh token presented again within this long after it was ROTATED gets
// the same successor back instead of triggering reuse detection: covers two
// tabs (or a retried request) refreshing with the same cookie at once. Past
// it, a rotated token is treated as stolen and every session is revoked.
// Audit H10.
export const REFRESH_ROTATION_GRACE_MS = 30 * 1000;

export const REFRESH_COOKIE_NAME = "refresh_token";

export const SIGNATURE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLOCK_SKEW_MS = 30 * 1000; // 30 seconds
