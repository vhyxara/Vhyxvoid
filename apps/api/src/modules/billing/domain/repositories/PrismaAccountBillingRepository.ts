import { PrismaClient } from "@/generated/prisma";
import { AccountBillingRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";

export class PrismaAccountBillingRepository implements AccountBillingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async setStripeCustomerId(
    accountId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { stripeCustomerId },
    });
  }

  async getStripeCustomerId(accountId: string): Promise<string | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { stripeCustomerId: true },
    });
    return account?.stripeCustomerId ?? null;
  }

  async findAccountIdByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<string | null> {
    const account = await this.prisma.account.findFirst({
      where: { stripeCustomerId },
      select: { id: true },
    });
    return account?.id ?? null;
  }

  async updateBillingStatus(
    accountId: string,
    params: {
      status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
      graceEndsAt: Date | null;
    },
  ): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        status: params.status,
        graceEndsAt: params.graceEndsAt,
        updatedAt: new Date(),
      },
    });
  }

  async markPastDue(
    accountId: string,
    graceEndsAt: Date,
  ): Promise<{ started: boolean; graceEndsAt: Date | null }> {
    const now = new Date();

    // Each step is one conditional UPDATE, so two webhook events racing each
    // other cannot both start the clock.
    const fromActive = await this.prisma.account.updateMany({
      where: { id: accountId, status: "ACTIVE" },
      data: { status: "PAST_DUE", graceEndsAt, updatedAt: now },
    });
    if (fromActive.count > 0) return { started: true, graceEndsAt };

    const missingDeadline = await this.prisma.account.updateMany({
      where: { id: accountId, status: "PAST_DUE", graceEndsAt: null },
      data: { graceEndsAt, updatedAt: now },
    });
    if (missingDeadline.count > 0) return { started: true, graceEndsAt };

    const existing = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true, graceEndsAt: true },
    });
    return {
      started: false,
      graceEndsAt: existing?.status === "PAST_DUE" ? existing.graceEndsAt : null,
    };
  }

  async getAccountOwnerEmail(accountId: string): Promise<string | null> {
    const member = await this.prisma.accountMember.findFirst({
      where: { accountId, roleLevel: 100 }, // OWNER
      include: { user: { select: { email: true } } },
    });
    return (member as any)?.user?.email ?? null;
  }
}
