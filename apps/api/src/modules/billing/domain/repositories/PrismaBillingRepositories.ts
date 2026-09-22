// ── Subscription Repository ───────────────────────────────────────────────────

import { Invoice } from "@/modules/billing/domain/entities/Invoice.entities";
import { Subscription } from "@/modules/billing/domain/entities/Subscription.entities";

// import { Subscription, Invoice } from "@/generated/prisma";

export interface SubscriptionRepository {
  save(subscription: Subscription): Promise<void>;
  findByAccountId(accountId: string): Promise<Subscription | null>;
  findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<Subscription | null>;
  findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<Subscription | null>;
}

// ── Invoice Repository ────────────────────────────────────────────────────────

export interface InvoiceRepository {
  save(invoice: Invoice): Promise<void>;
  findByAccountId(accountId: string, limit?: number): Promise<Invoice[]>;
  findByStripeInvoiceId(stripeInvoiceId: string): Promise<Invoice | null>;
}

// ── Account Billing Repository ────────────────────────────────────────────────
// Thin interface for the billing module to update Account fields.
// The billing module must not import from the identity module directly.

export interface AccountBillingRepository {
  /**
   * Set the Stripe Customer ID on the account.
   * Called once when we create a Stripe customer for this account.
   */
  setStripeCustomerId(
    accountId: string,
    stripeCustomerId: string,
  ): Promise<void>;

  /**
   * Get the Stripe Customer ID for an account.
   * Returns null if no customer exists yet.
   */
  getStripeCustomerId(accountId: string): Promise<string | null>;

  // Get the account ID by Stripe Customer ID
  findAccountIdByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<string | null>; // ← add

  /**
   * Update the account's billing status and grace period.
   * Called by webhook handler when payment fails or succeeds.
   */
  updateBillingStatus(
    accountId: string,
    params: {
      status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
      graceEndsAt: Date | null;
    },
  ): Promise<void>;

  /**
   * Put the account in PAST_DUE with a grace deadline, keeping any deadline
   * it already has (set-if-absent). Webhook events arrive in either order and
   * Stripe retries a failed payment several times, so this must be idempotent:
   * only the first call starts the clock.
   *
   * Only ACTIVE and PAST_DUE accounts are touched. A SUSPENDED / RESTRICTED /
   * CANCELED / DELETED account is left alone; otherwise a later Stripe retry
   * would turn an account the grace-period worker already suspended back into
   * PAST_DUE with a fresh grace period, forever.
   *
   * `started` is true only when this call set the deadline.
   */
  markPastDue(
    accountId: string,
    graceEndsAt: Date,
  ): Promise<{ started: boolean; graceEndsAt: Date | null }>;

  /**
   * Move the account back to ACTIVE — but only from PAST_DUE. This is the
   * billing-recovery transition (a failed-payment account started paying
   * again); it must never resurrect a SUSPENDED, RESTRICTED, CANCELED or
   * DELETED account, since those aren't necessarily billing-caused (there is
   * no field on Account today that says why it's in that state — see
   * shared/decision.md, "SUSPENDED-reactivation gap"). Un-suspending one of
   * those is a deliberate, explicit action, not something an unrelated
   * Stripe event should do.
   *
   * `activated` is true only when this call actually moved the account.
   */
  markActiveFromPastDue(accountId: string): Promise<{ activated: boolean }>;

  // Get the account owner's email
  getAccountOwnerEmail(accountId: string): Promise<string | null>;
}
