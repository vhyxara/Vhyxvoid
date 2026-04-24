// ─────────────────────────────────────────────────────────────────────────────
// ROTATION
// ─────────────────────────────────────────────────────────────────────────────

// import { ApiKeyEnvironment } from "@/core/types/api-key.types/apiKeys";
import { RoleLevel } from "@/core/constant/account.constant";

// import { ApiKeyEnvironment } from '../types/api-key/apiKeys';
// import { RoleLevel } from './account';

// ─────────────────────────────────────────────────────────────────────────────
// API KEY ENUMS & CONSTANTS
// Single source of truth. Import from here everywhere.
// ─────────────────────────────────────────────────────────────────────────────

export enum ApiKeyStatus {
  ACTIVE = "ACTIVE",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export enum ApiKeyEnvironment {
  DEV = "DEV",
  PROD = "PROD",
}

export enum ApiScope {
  // Tunnel operations
  TUNNEL_CONNECT = "tunnel:connect", // establish a tunnel connection
  TUNNEL_READ = "tunnel:read", // read tunnel status / info
  TUNNEL_WRITE = "tunnel:write", // create / configure tunnels

  // Webhook operations
  WEBHOOK_RECEIVE = "webhook:receive", // receive inbound webhooks
  WEBHOOK_INSPECT = "webhook:inspect", // inspect webhook history

  // Metrics
  METRICS_READ = "metrics:read", // read own usage / metrics

  // Wildcard — OWNER-level keys only, grants all scopes
  WILDCARD = "*",
}

export enum SecurityEventType {
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  REPLAY_ATTACK = "REPLAY_ATTACK",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  SCOPE_VIOLATION = "SCOPE_VIOLATION",
  EXPIRED_KEY = "EXPIRED_KEY",
  REVOKED_KEY = "REVOKED_KEY",
  SUSPENDED_ACCOUNT = "SUSPENDED_ACCOUNT",
}

/** How long the old secret remains valid after rotation (zero-downtime window). */
export const ROTATION_GRACE_MS = 60 * 60 * 1_000; // 1 hour

/** How long replay protection IDs are stored in Redis. */
export const REPLAY_WINDOW_MS = 60 * 1_000; // 1 minute

/** Signature timestamp tolerance — reject requests older than this. */
export const SIGNATURE_WINDOW_MS = 60 * 1_000; // 1 minute

/** Redis key TTL for cached API key data. */
export const KEY_CACHE_TTL_SEC = 5 * 60; // 5 minutes

/** How often the usage flush worker runs. */
export const USAGE_FLUSH_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

/** Key ID prefixes by environment. */
export const KEY_PREFIX: Record<ApiKeyEnvironment, string> = {
  [ApiKeyEnvironment.DEV]: "bksr_dev_",
  [ApiKeyEnvironment.PROD]: "bksr_live_",
};

// ─────────────────────────────────────────────────────────────────────────────
// ROLE-BASED API KEY PERMISSIONS
// Maps what each account role level can do with API keys.
// Checked in use cases against AccountMembership.roleLevel.
// ─────────────────────────────────────────────────────────────────────────────

export const API_KEY_PERMISSIONS = {
  /** Create a new API key */
  canCreate: (level: number) => level >= RoleLevel.ADMIN,

  /** List ALL keys in the account */
  canListAll: (level: number) => level >= RoleLevel.ADMIN,

  /** Revoke any key (not just own) */
  canRevokeAny: (level: number) => level >= RoleLevel.ADMIN,

  /** Rotate any key (not just own) */
  canRotateAny: (level: number) => level >= RoleLevel.ADMIN,

  /** Manage scopes on any key */
  canManageScopesAny: (level: number) => level >= RoleLevel.ADMIN,

  /** Hard delete (permanent) */
  canHardDelete: (level: number) => level >= RoleLevel.OWNER,

  /** Export usage CSV */
  canExportUsage: (level: number) => level >= RoleLevel.ADMIN,

  /** View usage analytics */
  canViewUsage: (level: number) => level >= RoleLevel.MEMBER,
} as const;
