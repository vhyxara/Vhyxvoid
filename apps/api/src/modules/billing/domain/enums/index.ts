// src/modules/billing/domain/enums/index.ts
//
// MERGED from:
//   src/core/types/api-key/planLimits.ts  (API key limits — existing)
//   src/modules/billing/domain/enums/index.ts  (tunnel/account limits — new)
//
// This is now the SINGLE SOURCE OF TRUTH for all plan configuration.
// After placing this file, update one import path:
//   HardcodedPlanLimitService: import from '@/modules/billing/domain/enums'
// Then delete: src/core/types/api-key/planLimits.ts

import { ApiKeyEnvironment } from "@/core/constant/apikey.constant";

// ── Plan ──────────────────────────────────────────────────────────────────────

export enum Plan {
  FREE = "FREE",
  PRO = "PRO",
  ENTERPRISE = "ENTERPRISE",
}

// Backward-compat alias — SubscriptionPlanLimitService uses PlanTier,
// nothing needs to change there.
export type PlanTier = Plan;

// ── Subscription status ───────────────────────────────────────────────────────

export enum SubscriptionStatus {
  TRIALING = "TRIALING",
  ACTIVE = "ACTIVE",
  PAST_DUE = "PAST_DUE",
  CANCELED = "CANCELED",
  UNPAID = "UNPAID",
  INCOMPLETE = "INCOMPLETE",
  PAUSED = "PAUSED",
}

// ── Invoice status ────────────────────────────────────────────────────────────

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  OPEN = "OPEN",
  PAID = "PAID",
  UNCOLLECTIBLE = "UNCOLLECTIBLE",
  VOID = "VOID",
}

// ── Plan limits ───────────────────────────────────────────────────────────────
// Combined: API key limits (from existing) + tunnel/account limits (new billing).
// One interface used everywhere — API key module, tunnel module, billing module.

export interface PlanLimits {
  // ── Account / tunnel limits (new billing module) ────────────────────────
  maxAgents: number; // concurrent tunnel agents
  maxRequestsPerMonth: number; // total tunnel requests per billing period
  maxMembers: number; // account members
  customDomains: boolean; // can use custom domains
  prioritySupport: boolean; // priority support tier

  // ── API key limits (existing — kept as-is) ──────────────────────────────
  maxApiKeys: number; // total API keys per account
  maxScopesPerKey: number; // scopes per key
  rateLimitPerMinute: number; // requests per minute per key
  allowedEnvironments: ApiKeyEnvironment[]; // which environments are allowed
  rotationAllowed: boolean; // can rotate secrets
  expiryAllowed: boolean; // can set expiry dates
  analyticsRetentionDays: number; // how long usage data is kept
  prodKeysAllowed: boolean; // can create PROD environment keys
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  [Plan.FREE]: {
    // Account / tunnel
    maxAgents: 1,
    maxRequestsPerMonth: 1_000,
    maxMembers: 1,
    customDomains: false,
    prioritySupport: false,
    // API keys
    maxApiKeys: 3,
    maxScopesPerKey: 2,
    rateLimitPerMinute: 60,
    allowedEnvironments: [ApiKeyEnvironment.DEV],
    rotationAllowed: false,
    expiryAllowed: false,
    analyticsRetentionDays: 7,
    prodKeysAllowed: false,
  },
  [Plan.PRO]: {
    // Account / tunnel
    maxAgents: 5,
    maxRequestsPerMonth: 50_000,
    maxMembers: 10,
    customDomains: true,
    prioritySupport: true,
    // API keys
    maxApiKeys: 20,
    maxScopesPerKey: 10,
    rateLimitPerMinute: 1_000,
    allowedEnvironments: [ApiKeyEnvironment.DEV, ApiKeyEnvironment.PROD],
    rotationAllowed: true,
    expiryAllowed: true,
    analyticsRetentionDays: 90,
    prodKeysAllowed: true,
  },
  [Plan.ENTERPRISE]: {
    // Account / tunnel
    maxAgents: Infinity,
    maxRequestsPerMonth: Infinity,
    maxMembers: Infinity,
    customDomains: true,
    prioritySupport: true,
    // API keys
    maxApiKeys: Infinity,
    maxScopesPerKey: Infinity,
    rateLimitPerMinute: Infinity,
    allowedEnvironments: [ApiKeyEnvironment.DEV, ApiKeyEnvironment.PROD],
    rotationAllowed: true,
    expiryAllowed: true,
    analyticsRetentionDays: 365,
    prodKeysAllowed: true,
  },
};

// ── Grace period ──────────────────────────────────────────────────────────────

export const GRACE_PERIOD_DAYS = 7;
export const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
