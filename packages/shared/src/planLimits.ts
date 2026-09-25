// packages/shared/src/planLimits.ts
//
// THE single source of truth for plan configuration, imported by apps/api
// (billing, key management) and apps/hub (agent limit). Before 2026-09-22 this
// lived in apps/api/src/modules/billing/domain/enums, with a second, hand-kept
// copy of the agent numbers in packages/protocol (PLAN_AGENT_LIMITS) that the
// hub used instead, ignoring the real plan. See shared/decision.md,
// 2026-09-22, "S3".
//
// Deliberately self-contained (no imports): apps/docs/scripts/generate.mjs
// evaluates this file directly to generate the public limits table.

// ── Plan ──────────────────────────────────────────────────────────────────────

export enum Plan {
  FREE = "FREE",
  PRO = "PRO",
  ENTERPRISE = "ENTERPRISE",
}

// Backward-compat alias — SubscriptionPlanLimitService uses PlanTier.
export type PlanTier = Plan;

/** Same values as apps/api's ApiKeyEnvironment enum, which stays in apps/api. */
export type PlanKeyEnvironment = "DEV" | "PROD";

// ── Plan limits ───────────────────────────────────────────────────────────────
// Combined: API key limits (from existing) + tunnel/account limits (new billing).
// One interface used everywhere — API key module, tunnel module, billing module.

export interface PlanLimits {
  // ── Account / tunnel limits (new billing module) ────────────────────────
  maxAgents: number; // concurrent tunnel agents
  maxRequestsPerMonth: number; // total tunnel requests per calendar month (soft — counted and shown, not enforced; see decision.md 2026-09-22 "Answers to the E1-E7 open questions" #6)
  publicPathRateLimitPerMinute: number; // abuse limiter for the public tunnel-URL path (no API key involved), per account across all its agents — see decision.md 2026-09-22 "S5 investigation and proposal"
  maxMembers: number; // account members
  customDomains: boolean; // can use custom domains
  prioritySupport: boolean; // priority support tier

  // ── API key limits (existing — kept as-is) ──────────────────────────────
  maxApiKeys: number; // total API keys per account
  maxScopesPerKey: number; // scopes per key
  rateLimitPerMinute: number; // requests per minute per key
  allowedEnvironments: PlanKeyEnvironment[]; // which environments are allowed
  rotationAllowed: boolean; // can rotate secrets
  expiryAllowed: boolean; // can set expiry dates
  analyticsRetentionDays: number; // how long usage data is kept
  prodKeysAllowed: boolean; // can create PROD environment keys
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  [Plan.FREE]: {
    // Account / tunnel
    maxAgents: 1,
    maxRequestsPerMonth: 10_000,
    publicPathRateLimitPerMinute: 100,
    maxMembers: 1,
    customDomains: false,
    prioritySupport: false,
    // API keys
    maxApiKeys: 3,
    maxScopesPerKey: 2,
    rateLimitPerMinute: 60,
    allowedEnvironments: ["DEV"],
    rotationAllowed: false,
    // Every plan: expiry limits the damage of a leaked key, so it is not a
    // paid feature (decided 2026-09-25, shared/decision.md).
    expiryAllowed: true,
    analyticsRetentionDays: 7,
    prodKeysAllowed: false,
  },
  [Plan.PRO]: {
    // Account / tunnel
    maxAgents: 5,
    maxRequestsPerMonth: 50_000,
    publicPathRateLimitPerMinute: 3_000,
    maxMembers: 10,
    customDomains: true,
    prioritySupport: true,
    // API keys
    maxApiKeys: 20,
    maxScopesPerKey: 10,
    rateLimitPerMinute: 1_000,
    allowedEnvironments: ["DEV", "PROD"],
    rotationAllowed: true,
    expiryAllowed: true,
    analyticsRetentionDays: 90,
    prodKeysAllowed: true,
  },
  [Plan.ENTERPRISE]: {
    // Account / tunnel
    maxAgents: Infinity,
    maxRequestsPerMonth: Infinity,
    publicPathRateLimitPerMinute: Infinity,
    maxMembers: Infinity,
    customDomains: true,
    prioritySupport: true,
    // API keys
    maxApiKeys: Infinity,
    maxScopesPerKey: Infinity,
    rateLimitPerMinute: Infinity,
    allowedEnvironments: ["DEV", "PROD"],
    rotationAllowed: true,
    expiryAllowed: true,
    analyticsRetentionDays: 365,
    prodKeysAllowed: true,
  },
};
