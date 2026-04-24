// ─────────────────────────────────────────────────────────────────────────────
// GetInvoicesUseCase
// Returns billing history for an account.
// ─────────────────────────────────────────────────────────────────────────────

import { Invoice } from "@/modules/billing/domain/entities/Invoice.entities";
import { InvoiceStatus } from "@/modules/billing/domain/enums";
import { InvoiceRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";

export class GetInvoicesUseCase {
  constructor(private readonly invoiceRepo: InvoiceRepository) {}

  async execute(
    accountId: string,
    limit = 20,
  ): Promise<{
    invoices: {
      id: string;
      amountDue: number;
      amountPaid: number;
      currency: string;
      status: InvoiceStatus;
      invoicePdfUrl: string | null;
      hostedInvoiceUrl: string | null;
      paidAt: Date | null;
      periodStart: Date | null;
      periodEnd: Date | null;
    }[];
  }> {
    const invoices = await this.invoiceRepo.findByAccountId(accountId, limit);
    return {
      invoices: invoices.map((inv: Invoice) => ({
        id: inv.id,
        amountDue: inv.amountDue,
        amountPaid: inv.amountPaid,
        currency: inv.currency,
        status: inv.status,
        invoicePdfUrl: inv.invoicePdfUrl,
        hostedInvoiceUrl: inv.hostedInvoiceUrl,
        paidAt: inv.paidAt,
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
      })),
    };
  }
}
