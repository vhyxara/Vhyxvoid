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

  async markActiveFromPastDue(accountId: string): Promise<{ activated: boolean }> {
    // One conditional UPDATE — the guard is the whole point: an account that
    // is SUSPENDED, RESTRICTED, CANCELED or DELETED (for any reason, billing
    // or otherwise) is left exactly as it is. An already-ACTIVE account also
    // doesn't match, so this is a safe no-op on the common "subscription
    // touched but nothing changed" case, not just on the ones it must refuse.
    const result = await this.prisma.account.updateMany({
      where: { id: accountId, status: "PAST_DUE" },
      data: { status: "ACTIVE", graceEndsAt: null, updatedAt: new Date() },
    });
    return { activated: result.count > 0 };
  }

  async endPaidSubscription(accountId: string): Promise<{ changed: boolean }> {
    // The plan itself drops to FREE through the plan resolver (a canceled
    // subscription no longer entitles). Here the account only leaves the
    // billing states: PAST_DUE (this subscription's grace period) and the
    // legacy CANCELED. Admin decisions (SUSPENDED, RESTRICTED, DELETED) are
    // left alone, and so is PAST_DUE while another subscription is unpaid.
    const otherUnpaid = await this.prisma.subscription.count({
      where: { accountId, status: { in: ["PAST_DUE", "UNPAID"] } },
    });
    const result = await this.prisma.account.updateMany({
      where: { id: accountId, status: { in: otherUnpaid > 0 ? ["CANCELED"] : ["PAST_DUE", "CANCELED"] } },
      data: { status: "ACTIVE", graceEndsAt: null, updatedAt: new Date() },
    });
    return { changed: result.count > 0 };
  }

  async getAccountOwnerEmail(accountId: string): Promise<string | null> {
    const member = await this.prisma.accountMember.findFirst({
      where: { accountId, roleLevel: 100 }, // OWNER
      include: { user: { select: { email: true } } },
    });
    return (member as any)?.user?.email ?? null;
  }

  async getAccountOwnerContact(accountId: string): Promise<{ email: string; firstName: string; accountName: string } | null> {
    const member = await this.prisma.accountMember.findFirst({
      where: { accountId, roleLevel: 100 }, // OWNER
      select: { user: { select: { email: true, firstName: true } }, account: { select: { name: true, type: true } } },
    });
    if (!member) return null;
    const accountName = member.account.type === "PERSONAL" ? "your personal workspace" : member.account.name;
    return { email: member.user.email, firstName: member.user.firstName ?? "", accountName };
  }
}
