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

  // Get the account owner's email
  getAccountOwnerEmail(accountId: string): Promise<string | null>;
}
