// src/modules/billing/domain/entities/Subscription.ts
// The active subscription for an Account.
// One subscription per account — upserted on Stripe webhook events.
// Source of truth for plan and billing status.

import { Plan, SubscriptionStatus } from "@/modules/billing/domain/enums";

export interface SubscriptionProps {
  id: string;
  accountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  stripeProductId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  // ── Factories ──────────────────────────────────────────────────────────────

  /**
   * Called when Stripe fires customer.subscription.created.
   * All Stripe IDs must be resolved before calling this.
   */
  static create(
    params: Omit<SubscriptionProps, "id" | "createdAt" | "updatedAt">,
  ): Subscription {
    const now = new Date();
    return new Subscription({
      ...params,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: SubscriptionProps): Subscription {
    return new Subscription(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get stripeCustomerId(): string {
    return this.props.stripeCustomerId;
  }
  get stripeSubscriptionId(): string {
    return this.props.stripeSubscriptionId;
  }
  get stripePriceId(): string {
    return this.props.stripePriceId;
  }
  get plan(): Plan {
    return this.props.plan;
  }
  get status(): SubscriptionStatus {
    return this.props.status;
  }
  get currentPeriodEnd(): Date {
    return this.props.currentPeriodEnd;
  }
  get cancelAtPeriodEnd(): boolean {
    return this.props.cancelAtPeriodEnd;
  }
  get trialEndsAt(): Date | null {
    return this.props.trialEndsAt;
  }
  get canceledAt(): Date | null {
    return this.props.canceledAt;
  }

  isActive(): boolean {
    return this.props.status === SubscriptionStatus.ACTIVE;
  }
  isTrialing(): boolean {
    return this.props.status === SubscriptionStatus.TRIALING;
  }
  isPastDue(): boolean {
    return this.props.status === SubscriptionStatus.PAST_DUE;
  }
  isCanceled(): boolean {
    return this.props.status === SubscriptionStatus.CANCELED;
  }

  /** True if account should still have access (active, trialing, or canceled but period not ended) */
  hasAccess(now: Date): boolean {
    if (this.isActive() || this.isTrialing()) return true;
    if (this.isCanceled() && this.props.currentPeriodEnd > now) return true;
    return false;
  }

  // ── Business Logic ─────────────────────────────────────────────────────────

  /**
   * Apply a Stripe subscription update — called by webhook handler.
   * Updates all mutable fields atomically from the Stripe event data.
   */
  applyStripeUpdate(params: {
    stripePriceId: string;
    stripeProductId: string;
    plan: Plan;
    status: SubscriptionStatus;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    trialStartsAt: Date | null;
    trialEndsAt: Date | null;
  }): void {
    this.props.stripePriceId = params.stripePriceId;
    this.props.stripeProductId = params.stripeProductId;
    this.props.plan = params.plan;
    this.props.status = params.status;
    this.props.currentPeriodStart = params.currentPeriodStart;
    this.props.currentPeriodEnd = params.currentPeriodEnd;
    this.props.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
    this.props.canceledAt = params.canceledAt;
    this.props.trialStartsAt = params.trialStartsAt;
    this.props.trialEndsAt = params.trialEndsAt;
    this.props.updatedAt = new Date();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  toPersistence(): SubscriptionProps {
    return { ...this.props };
  }
}
