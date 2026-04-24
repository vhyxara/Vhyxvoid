import { PrismaClient } from "@/generated/prisma";
import { InvoiceRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";
import { Invoice } from "@/modules/billing/domain/entities/Invoice.entities";
import { InvoiceStatus as PrismaInvoiceStatus } from "@/modules/billing/domain/enums";

const toprismaStatus = (status: string): PrismaInvoiceStatus => {
  const map: Record<string, PrismaInvoiceStatus> = {
    draft: PrismaInvoiceStatus.DRAFT,
    open: PrismaInvoiceStatus.OPEN,
    paid: PrismaInvoiceStatus.PAID,
    uncollectible: PrismaInvoiceStatus.UNCOLLECTIBLE,
    void: PrismaInvoiceStatus.VOID,
    // already uppercase (from your domain enum)
    DRAFT: PrismaInvoiceStatus.DRAFT,
    OPEN: PrismaInvoiceStatus.OPEN,
    PAID: PrismaInvoiceStatus.PAID,
    UNCOLLECTIBLE: PrismaInvoiceStatus.UNCOLLECTIBLE,
    VOID: PrismaInvoiceStatus.VOID,
  };
  const mapped = map[status];
  if (!mapped) {
    console.warn(
      `[InvoiceRepo] unknown status "${status}", defaulting to OPEN`,
    );
    return PrismaInvoiceStatus.OPEN;
  }
  return mapped;
};

export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(invoice: Invoice): Promise<void> {
    const p = invoice.toPersistence();
    const status = toprismaStatus(p.status);

    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: p.stripeInvoiceId },
      update: {
        status,
        amountPaid: p.amountPaid,
        invoicePdfUrl: p.invoicePdfUrl,
        hostedInvoiceUrl: p.hostedInvoiceUrl,
        paidAt: p.paidAt,
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        stripeInvoiceId: p.stripeInvoiceId,
        stripeCustomerId: p.stripeCustomerId,
        stripeSubscriptionId: p.stripeSubscriptionId,
        amountDue: p.amountDue,
        amountPaid: p.amountPaid,
        currency: p.currency,
        status,
        description: p.description,
        invoicePdfUrl: p.invoicePdfUrl,
        hostedInvoiceUrl: p.hostedInvoiceUrl,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        paidAt: p.paidAt,
        dueDate: p.dueDate,
        createdAt: p.createdAt,
      },
    });
  }

  async findByAccountId(accountId: string, limit = 20): Promise<Invoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findByStripeInvoiceId(
    stripeInvoiceId: string,
  ): Promise<Invoice | null> {
    const row = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId },
    });
    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: any): Invoice {
    return Invoice.rehydrate({
      id: row.id,
      accountId: row.accountId,
      stripeInvoiceId: row.stripeInvoiceId,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      amountDue: row.amountDue,
      amountPaid: row.amountPaid,
      currency: row.currency,
      status: row.status as PrismaInvoiceStatus,
      description: row.description,
      invoicePdfUrl: row.invoicePdfUrl,
      hostedInvoiceUrl: row.hostedInvoiceUrl,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      paidAt: row.paidAt,
      dueDate: row.dueDate,
      createdAt: row.createdAt,
    });
  }
}
