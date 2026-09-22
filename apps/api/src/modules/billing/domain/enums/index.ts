// src/modules/billing/domain/enums/index.ts
//
// Billing enums (subscription/invoice status, grace period). Plan and
// PLAN_LIMITS are defined in packages/shared (src/planLimits.ts), the single
// source of truth for plan configuration, and re-exported below.

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
// Moved to packages/shared (src/planLimits.ts) on 2026-09-22 so apps/hub can
// use the real plan's limits too. Re-exported here so billing code keeps its
// import path; this is not a second copy.
export { Plan, PLAN_LIMITS } from "@vhyxvoid/shared";
export type { PlanLimits, PlanTier } from "@vhyxvoid/shared";

// ── Grace period ──────────────────────────────────────────────────────────────

export const GRACE_PERIOD_DAYS = 7;
export const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
