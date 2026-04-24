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

  async getAccountOwnerEmail(accountId: string): Promise<string | null> {
    const member = await this.prisma.accountMember.findFirst({
      where: { accountId, roleLevel: 100 }, // OWNER
      include: { user: { select: { email: true } } },
    });
    return (member as any)?.user?.email ?? null;
  }
}
