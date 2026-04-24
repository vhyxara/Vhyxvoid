// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/domain/entities/Invoice.ts
// Billing history record. Append-only — never updated after creation.
// Created by invoice.payment_succeeded and invoice.payment_failed webhooks.
// ─────────────────────────────────────────────────────────────────────────────

import { InvoiceStatus } from "@/modules/billing/domain/enums";

export interface InvoiceProps {
  id: string;
  accountId: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  amountDue: number; // in cents (Stripe convention)
  amountPaid: number; // in cents
  currency: string; // e.g. 'usd'
  status: InvoiceStatus;
  description: string | null;
  invoicePdfUrl: string | null; // downloadable PDF
  hostedInvoiceUrl: string | null; // Stripe-hosted page
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  dueDate: Date | null;
  createdAt: Date;
}

export class Invoice {
  private constructor(private props: InvoiceProps) {}

  static create(params: Omit<InvoiceProps, "id" | "createdAt">): Invoice {
    return new Invoice({
      ...params,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    });
  }

  static rehydrate(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get stripeInvoiceId(): string {
    return this.props.stripeInvoiceId;
  }
  get amountDue(): number {
    return this.props.amountDue;
  }
  get amountPaid(): number {
    return this.props.amountPaid;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): InvoiceStatus {
    return this.props.status;
  }
  get invoicePdfUrl(): string | null {
    return this.props.invoicePdfUrl;
  }
  get hostedInvoiceUrl(): string | null {
    return this.props.hostedInvoiceUrl;
  }
  get paidAt(): Date | null {
    return this.props.paidAt;
  }
  get periodStart(): Date | null {
    return this.props.periodStart;
  }
  get periodEnd(): Date | null {
    return this.props.periodEnd;
  }

  /** Amount in major currency units (dollars, euros, etc.) */
  get amountDueFormatted(): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.props.currency.toUpperCase(),
    }).format(this.props.amountDue / 100);
  }

  isPaid(): boolean {
    return this.props.status === InvoiceStatus.PAID;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  toPersistence(): InvoiceProps {
    return { ...this.props };
  }
}
