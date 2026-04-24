// ─────────────────────────────────────────────────────────────────────────────
// HandleStripeWebhookUseCase
// THE CORE of the billing module. Processes all Stripe webhook events.
// This is the state machine that drives account status transitions.
//
// Idempotent: Stripe may deliver the same event multiple times.
// Each handler checks the current state before applying changes.
// ─────────────────────────────────────────────────────────────────────────────

// import { SubscriptionStatus } from "@/generated/prisma";
import { Invoice } from "@/modules/billing/domain/entities/Invoice.entities";
import { Subscription } from "@/modules/billing/domain/entities/Subscription.entities";
import {
  InvoiceStatus,
  GRACE_PERIOD_MS,
  SubscriptionStatus,
} from "@/modules/billing/domain/enums";
import {
  SubscriptionRepository,
  InvoiceRepository,
  AccountBillingRepository,
} from "@/modules/billing/domain/repositories/PrismaBillingRepositories";
// import {
//   SubscriptionRepository,
//   InvoiceRepository,
//   AccountBillingRepository,
// } from "@/modules/billing/domain/repositories";
import { IStripeService } from "@/modules/billing/domain/services/Stripe.service";
import { NotificationService } from "@/modules/notification/application/use-cases";

export class HandleStripeWebhookUseCase {
  constructor(
    private readonly stripeService: IStripeService,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly invoiceRepo: InvoiceRepository,

    private readonly accountBillingRepo: AccountBillingRepository,
    private readonly notificationService?: NotificationService, // optional — fire-and-forget
  ) {}

  async execute(
    payload: Buffer,
    signature: string,
  ): Promise<{ received: true }> {
    // 1. Verify signature — throws if invalid (Stripe-signed events only)
    const event = this.stripeService.constructWebhookEvent(payload, signature);

    // 2. Route to correct handler
    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
          await this.handleSubscriptionUpsert(event.data.object as any);
          break;

        case "customer.subscription.deleted":
          await this.handleSubscriptionDeleted(event.data.object as any);
          break;

        case "invoice.payment_succeeded":
          await this.handleInvoicePaymentSucceeded(event.data.object as any);
          break;

        case "invoice.payment_failed":
          await this.handleInvoicePaymentFailed(event.data.object as any);
          break;

        case "invoice.created":
        case "invoice.finalized":
        case "invoice.updated":
          await this.handleInvoiceUpsert(event.data.object as any);
          break;

        // Events we acknowledge but don't act on yet
        case "customer.subscription.trial_will_end":
        case "customer.created":
        case "customer.updated":
        case "payment_method.attached":
          break;

        default:
          // Unknown event type — log but don't fail (Stripe adds new events)
          console.info(
            { eventType: event.type },
            "[billing] unhandled webhook event type",
          );
      }
    } catch (err) {
      // Log the actual error — currently it swallows silently causing 500
      console.error(
        { eventType: event.type, err },
        "[billing] webhook handler failed",
      );
      throw err; // re-throw so Stripe gets the 500 and retries
    }
    return { received: true };
  }

  // ── Private event handlers ─────────────────────────────────────────────────

  /**
   * customer.subscription.created / customer.subscription.updated
   * Creates or updates our Subscription record and syncs account status.
   */
  // private async handleSubscriptionUpsert(stripeSub: {
  //   id: string;
  //   customer: string;
  //   status: string;
  //   items: { data: Array<{ price: { id: string; product: string } }> };
  //   current_period_start: number;
  //   current_period_end: number;
  //   cancel_at_period_end: boolean;
  //   canceled_at: number | null;
  //   trial_start: number | null;
  //   trial_end: number | null;
  //   metadata: Record<string, string>;
  // }): Promise<void> {
  //   console.log(
  //     "[billing] stripeSub dates:",
  //     {
  //       id: stripeSub.id,
  //       status: stripeSub.status,
  //       current_period_start: stripeSub.current_period_start,
  //       current_period_end: stripeSub.current_period_end,
  //       billing_cycle_anchor: stripeSub.billing_cycle_anchor,
  //     },
  //     "stripesub",
  //     stripeSub,
  //   );
  //   try {
  //     const priceItem = stripeSub.items?.data?.[0];

  //     if (!priceItem) {
  //       console.warn(
  //         { stripeSubId: stripeSub.id },
  //         "[billing] subscription has no price items, skipping",
  //       );
  //       return;
  //     }

  //     const stripePriceId = priceItem.price.id;
  //     const plan = this.stripeService.resolvePlan(stripePriceId);
  //     const status = this.mapStripeStatus(stripeSub.status);

  //     const toDate = (unixSeconds: number | null | undefined): Date | null => {
  //       if (!unixSeconds || unixSeconds === 0) return null;
  //       const d = new Date(unixSeconds * 1000);
  //       return isNaN(d.getTime()) ? null : d;
  //     };

  //     // Use billing_cycle_anchor as fallback when period dates are 0
  //     const anchor = stripeSub.billing_cycle_anchor;
  //     const currentPeriodStart =
  //       toDate(stripeSub.current_period_start) ?? toDate(anchor);
  //     const currentPeriodEnd =
  //       toDate(stripeSub.current_period_end) ??
  //       (anchor ? new Date((anchor + 30 * 24 * 60 * 60) * 1000) : null); // anchor + 30 days

  //     // If still no dates, use now as fallback rather than skipping
  //     const now = new Date();
  //     const safePeriodStart = currentPeriodStart ?? now;
  //     const safePeriodEnd =
  //       currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  //     // const currentPeriodStart = toDate(stripeSub.current_period_start);
  //     // const currentPeriodEnd = toDate(stripeSub.current_period_end);

  //     // Skip if dates are missing — subscription is not yet active
  //     // Stripe will send customer.subscription.updated when it activates
  //     // if (!currentPeriodStart || !currentPeriodEnd) {
  //     //   console.info(
  //     //     { stripeSubId: stripeSub.id, status: stripeSub.status },
  //     //     "[billing] subscription has no period dates yet — skipping until active",
  //     //   );
  //     //   return;
  //     // }

  //     // Find or create our Subscription record
  //     let sub = await this.subscriptionRepo.findByStripeSubscriptionId(
  //       stripeSub.id,
  //     );

  //     // Resolve accountId from Stripe metadata or customer lookup
  //     const accountId =
  //       stripeSub.metadata?.accountId ??
  //       (await this.resolveAccountIdFromCustomer(stripeSub.customer));

  //     if (!accountId) {
  //       console.error(
  //         { stripeSubId: stripeSub.id },
  //         "[billing] cannot resolve accountId for subscription",
  //       );
  //       return;
  //     }

  //     const updateParams = {
  //       stripePriceId,
  //       stripeProductId: priceItem.price.product,
  //       plan,
  //       status,
  //       currentPeriodStart: safePeriodStart,
  //       currentPeriodEnd: safePeriodEnd,
  //       cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
  //       canceledAt: stripeSub.canceled_at
  //         ? new Date(stripeSub.canceled_at * 1000)
  //         : null,
  //       trialStartsAt: stripeSub.trial_start
  //         ? new Date(stripeSub.trial_start * 1000)
  //         : null,
  //       trialEndsAt: stripeSub.trial_end
  //         ? new Date(stripeSub.trial_end * 1000)
  //         : null,
  //     };

  //     if (sub) {
  //       // Update existing
  //       sub.applyStripeUpdate(updateParams);
  //     } else {
  //       // Create new
  //       sub = Subscription.create({
  //         accountId,
  //         stripeCustomerId: stripeSub.customer,
  //         stripeSubscriptionId: stripeSub.id,
  //         ...updateParams,
  //       });
  //     }

  //     await this.subscriptionRepo.save(sub);

  //     // Sync account status
  //     await this.accountBillingRepo.updateBillingStatus(accountId, {
  //       status: this.subscriptionStatusToAccountStatus(status),
  //       graceEndsAt: null,
  //     });
  //   } catch (err) {
  //     console.error(
  //       { stripeSubId: stripeSub.id, err },
  //       "[billing] failed to handle subscription upsert",
  //     );
  //     throw err;
  //   }
  // }

  private async handleSubscriptionUpsert(stripeSub: any): Promise<void> {
    try {
      const priceItem = stripeSub.items?.data?.[0];
      if (!priceItem) {
        console.warn(
          { stripeSubId: stripeSub.id },
          "[billing] no price items, skipping",
        );
        return;
      }

      const stripePriceId = priceItem.price.id;
      const plan = this.stripeService.resolvePlan(stripePriceId);
      const status = this.mapStripeStatus(stripeSub.status);

      const toDate = (unixSeconds: number | null | undefined): Date | null => {
        if (!unixSeconds || unixSeconds === 0) return null;
        const d = new Date(unixSeconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      };

      // ── Handle Stripe API 2026-03-25.dahlia — period fields moved ────────────
      // New API version no longer sends current_period_start/end at top level.
      // Read from: items.data[0].current_period (if present), then billing_cycle_anchor fallback.
      const itemPeriod = priceItem.current_period ?? null;

      const rawStart =
        stripeSub.current_period_start ?? // old API
        itemPeriod?.start ?? // new API (item-level)
        stripeSub.billing_cycle_anchor ?? // fallback
        stripeSub.start_date; // last resort

      const rawEnd =
        stripeSub.current_period_end ?? // old API
        itemPeriod?.end ?? // new API (item-level)
        (rawStart ? rawStart + 30 * 24 * 60 * 60 : null); // fallback: start + 30 days

      const now = new Date();
      const safePeriodStart = toDate(rawStart) ?? now;
      const safePeriodEnd =
        toDate(rawEnd) ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const accountId =
        stripeSub.metadata?.accountId ??
        (await this.resolveAccountIdFromCustomer(stripeSub.customer));

      if (!accountId) {
        console.error(
          { stripeSubId: stripeSub.id },
          "[billing] cannot resolve accountId",
        );
        return;
      }

      let sub = await this.subscriptionRepo.findByStripeSubscriptionId(
        stripeSub.id,
      );

      const updateParams = {
        stripePriceId,
        stripeProductId: priceItem.price.product,
        plan,
        status,
        currentPeriodStart: safePeriodStart,
        currentPeriodEnd: safePeriodEnd,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        canceledAt: stripeSub.canceled_at
          ? new Date(stripeSub.canceled_at * 1000)
          : null,
        trialStartsAt: stripeSub.trial_start
          ? new Date(stripeSub.trial_start * 1000)
          : null,
        trialEndsAt: stripeSub.trial_end
          ? new Date(stripeSub.trial_end * 1000)
          : null,
      };

      if (sub) {
        sub.applyStripeUpdate(updateParams);
      } else {
        sub = Subscription.create({
          accountId,
          stripeCustomerId: stripeSub.customer,
          stripeSubscriptionId: stripeSub.id,
          ...updateParams,
        });
      }

      await this.subscriptionRepo.save(sub);

      await this.accountBillingRepo.updateBillingStatus(accountId, {
        status: this.subscriptionStatusToAccountStatus(status),
        graceEndsAt: null,
      });

      console.info(
        {
          stripeSubId: stripeSub.id,
          status: stripeSub.status,
          plan,
          accountId,
        },
        "[billing] subscription upserted successfully",
      );
    } catch (err) {
      console.error(
        { stripeSubId: stripeSub.id, err },
        "[billing] handleSubscriptionUpsert failed",
      );
      throw err;
    }
  }

  /**
   * customer.subscription.deleted
   * Subscription fully canceled. Update account status to CANCELED.
   */
  private async handleSubscriptionDeleted(stripeSub: {
    id: string;
    customer: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    const sub = await this.subscriptionRepo.findByStripeSubscriptionId(
      stripeSub.id,
    );
    if (!sub) return; // idempotent

    sub.applyStripeUpdate({
      ...sub.toPersistence(),
      status: SubscriptionStatus.CANCELED,
      canceledAt: new Date(),
    } as any);

    await this.subscriptionRepo.save(sub);
    await this.accountBillingRepo.updateBillingStatus(sub.accountId, {
      status: "CANCELED",
      graceEndsAt: null,
    });
    const ownerEmail = await this.accountBillingRepo.getAccountOwnerEmail?.(
      sub.accountId,
    );
    if (ownerEmail && this.notificationService) {
      this.notificationService.sendSubscriptionCanceled
        .execute({
          to: ownerEmail,
          firstName: "",
          accountName: sub.accountId,
          accessEndsAt: sub.currentPeriodEnd,
        })
        .catch((err) =>
          console.error(
            "[notifications] subscription canceled email failed",
            err,
          ),
        );
    }
  }

  /**
   * invoice.payment_succeeded
   * Payment went through. Activate account if it was PAST_DUE.
   * Record the invoice.
   */
  private async handleInvoicePaymentSucceeded(
    stripeInvoice: any,
  ): Promise<void> {
    await this.upsertInvoice(stripeInvoice, InvoiceStatus.PAID);

    // Find account via subscription
    if (stripeInvoice.subscription) {
      const sub = await this.subscriptionRepo.findByStripeSubscriptionId(
        stripeInvoice.subscription,
      );

      if (sub) {
        // Send payment success email — fire and forget
        const ownerEmail = await this.accountBillingRepo.getAccountOwnerEmail?.(
          sub.accountId,
        );
        if (ownerEmail && this.notificationService) {
          const amountFormatted = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: stripeInvoice.currency ?? "usd",
          }).format((stripeInvoice.amount_paid ?? 0) / 100);

          this.notificationService.sendPaymentSucceeded
            .execute({
              to: ownerEmail,
              firstName: "",
              accountName: sub.accountId,
              amountFormatted,
              invoiceUrl: stripeInvoice.hosted_invoice_url ?? "",
              periodEnd: sub.currentPeriodEnd,
            })
            .catch((err) =>
              console.error(
                "[notifications] payment succeeded email failed",
                err,
              ),
            );
        }
        if (sub?.isPastDue()) {
          // Payment recovered — reactivate account
          sub.applyStripeUpdate({
            ...sub.toPersistence(),
            status: SubscriptionStatus.ACTIVE,
          } as any);
          await this.subscriptionRepo.save(sub);
          await this.accountBillingRepo.updateBillingStatus(sub.accountId, {
            status: "ACTIVE",
            graceEndsAt: null,
          });
        }
      }
    }
  }

  /**
   * invoice.payment_failed
   * Payment failed. Mark PAST_DUE and start the grace period.
   * After grace period expires (7 days), a cron will SUSPEND the account.
   */
  private async handleInvoicePaymentFailed(stripeInvoice: any): Promise<void> {
    await this.upsertInvoice(stripeInvoice, InvoiceStatus.OPEN);

    if (stripeInvoice.subscription) {
      const sub = await this.subscriptionRepo.findByStripeSubscriptionId(
        stripeInvoice.subscription,
      );
      if (sub && !sub.isPastDue()) {
        sub.applyStripeUpdate({
          ...sub.toPersistence(),
          status: SubscriptionStatus.PAST_DUE,
        } as any);
        await this.subscriptionRepo.save(sub);

        const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_MS);
        // Send payment failed email — fire and forget
        const ownerEmail = await this.accountBillingRepo.getAccountOwnerEmail?.(
          sub.accountId,
        );
        if (ownerEmail && this.notificationService) {
          const amountFormatted = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: stripeInvoice.currency ?? "usd",
          }).format((stripeInvoice.amount_due ?? 0) / 100);

          this.notificationService.sendPaymentFailed
            .execute({
              to: ownerEmail,
              firstName: "",
              accountName: sub.accountId,
              amountFormatted,
              graceEndsAt,
            })
            .catch((err) =>
              console.error("[notifications] payment failed email failed", err),
            );
        }

        await this.accountBillingRepo.updateBillingStatus(sub.accountId, {
          status: "PAST_DUE",
          graceEndsAt,
        });
      }
    }
  }

  private async handleInvoiceUpsert(stripeInvoice: any): Promise<void> {
    // Stripe sends lowercase: "open", "paid", "draft" etc.
    // Map to your domain InvoiceStatus (uppercase)
    const statusMap: Record<string, InvoiceStatus> = {
      draft: InvoiceStatus.DRAFT,
      open: InvoiceStatus.OPEN,
      paid: InvoiceStatus.PAID,
      uncollectible: InvoiceStatus.UNCOLLECTIBLE,
      void: InvoiceStatus.VOID,
    };

    const status = statusMap[stripeInvoice.status] ?? InvoiceStatus.OPEN;
    await this.upsertInvoice(stripeInvoice, status);

    // await this.upsertInvoice(
    //   stripeInvoice,
    //   stripeInvoice.status as InvoiceStatus,
    // );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async upsertInvoice(
    stripeInvoice: any,
    status: InvoiceStatus,
  ): Promise<void> {
    const existing = await this.invoiceRepo.findByStripeInvoiceId(
      stripeInvoice.id,
    );

    // Resolve accountId from subscription or customer
    let accountId: string | null = null;
    if (stripeInvoice.subscription) {
      const sub = await this.subscriptionRepo.findByStripeSubscriptionId(
        stripeInvoice.subscription,
      );
      accountId = sub?.accountId ?? null;
    }
    if (!accountId) {
      accountId = await this.resolveAccountIdFromCustomer(
        stripeInvoice.customer,
      );
    }
    if (!accountId) return;

    const invoice = Invoice.create({
      accountId,
      stripeInvoiceId: stripeInvoice.id,
      stripeCustomerId: stripeInvoice.customer,
      stripeSubscriptionId: stripeInvoice.subscription ?? null,
      amountDue: stripeInvoice.amount_due,
      amountPaid: stripeInvoice.amount_paid,
      currency: stripeInvoice.currency,
      status,
      description: stripeInvoice.description ?? null,
      invoicePdfUrl: stripeInvoice.invoice_pdf ?? null,
      hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
      periodStart: stripeInvoice.period_start
        ? new Date(stripeInvoice.period_start * 1000)
        : null,
      periodEnd: stripeInvoice.period_end
        ? new Date(stripeInvoice.period_end * 1000)
        : null,
      paidAt: stripeInvoice.status_transitions?.paid_at
        ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
        : null,
      dueDate: stripeInvoice.due_date
        ? new Date(stripeInvoice.due_date * 1000)
        : null,
    });

    await this.invoiceRepo.save(invoice);
  }

  private async resolveAccountIdFromCustomer(
    stripeCustomerId: string,
  ): Promise<string | null> {
    const sub =
      await this.subscriptionRepo.findByStripeCustomerId(stripeCustomerId);
    // return sub?.accountId ?? null;
    if (sub?.accountId) return sub.accountId;

    // Fallback: look up account directly by stripeCustomerId
    return this.accountBillingRepo.findAccountIdByStripeCustomerId(
      stripeCustomerId,
    );
  }

  private mapStripeStatus(stripeStatus: string): SubscriptionStatus {
    const map: Record<string, SubscriptionStatus> = {
      trialing: SubscriptionStatus.TRIALING,
      active: SubscriptionStatus.ACTIVE,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      unpaid: SubscriptionStatus.UNPAID,
      incomplete: SubscriptionStatus.INCOMPLETE,
      paused: SubscriptionStatus.PAUSED,
      incomplete_expired: SubscriptionStatus.INCOMPLETE,
    };
    return map[stripeStatus] ?? SubscriptionStatus.INCOMPLETE;
  }

  private subscriptionStatusToAccountStatus(
    status: SubscriptionStatus,
  ): "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED" {
    switch (status) {
      case SubscriptionStatus.ACTIVE:
      case SubscriptionStatus.TRIALING:
        return "ACTIVE";
      case SubscriptionStatus.PAST_DUE:
      case SubscriptionStatus.UNPAID:
        return "PAST_DUE";
      case SubscriptionStatus.CANCELED:
        return "CANCELED";
      default:
        return "PAST_DUE";
    }
  }
}
