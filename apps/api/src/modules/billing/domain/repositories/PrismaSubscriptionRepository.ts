import {
  PrismaClient,
  SubscriptionStatus as PrismaSubscriptionStatus,
  Plan as PrismaPlan,
} from "@/generated/prisma";
import { SubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";
import { Subscription } from "@/modules/billing/domain/entities/Subscription.entities";
import { Plan, SubscriptionStatus } from "@/modules/billing/domain/enums";

const toPrismaSubStatus = (status: string): PrismaSubscriptionStatus => {
  const map: Record<string, PrismaSubscriptionStatus> = {
    TRIALING: PrismaSubscriptionStatus.TRIALING,
    ACTIVE: PrismaSubscriptionStatus.ACTIVE,
    PAST_DUE: PrismaSubscriptionStatus.PAST_DUE,
    CANCELED: PrismaSubscriptionStatus.CANCELED,
    UNPAID: PrismaSubscriptionStatus.UNPAID,
    INCOMPLETE: PrismaSubscriptionStatus.INCOMPLETE,
    PAUSED: PrismaSubscriptionStatus.PAUSED,
  };
  return map[status] ?? PrismaSubscriptionStatus.INCOMPLETE;
};

const toPrismaPlan = (plan: string): PrismaPlan => {
  const map: Record<string, PrismaPlan> = {
    FREE: PrismaPlan.FREE,
    PRO: PrismaPlan.PRO,
    ENTERPRISE: PrismaPlan.ENTERPRISE,
  };
  return map[plan] ?? PrismaPlan.FREE;
};

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(subscription: Subscription): Promise<void> {
    const p = subscription.toPersistence();
    const status = toPrismaSubStatus(p.status);
    const plan = toPrismaPlan(p.plan);

    await this.prisma.subscription.upsert({
      where: { id: p.id },
      update: {
        stripePriceId: p.stripePriceId,
        stripeProductId: p.stripeProductId,
        plan,
        status,
        currentPeriodStart: p.currentPeriodStart,
        currentPeriodEnd: p.currentPeriodEnd,
        cancelAtPeriodEnd: p.cancelAtPeriodEnd,
        canceledAt: p.canceledAt,
        trialStartsAt: p.trialStartsAt,
        trialEndsAt: p.trialEndsAt,
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        stripeCustomerId: p.stripeCustomerId,
        stripeSubscriptionId: p.stripeSubscriptionId,
        stripePriceId: p.stripePriceId,
        stripeProductId: p.stripeProductId,
        plan,
        status,
        currentPeriodStart: p.currentPeriodStart,
        currentPeriodEnd: p.currentPeriodEnd,
        cancelAtPeriodEnd: p.cancelAtPeriodEnd,
        canceledAt: p.canceledAt,
        trialStartsAt: p.trialStartsAt,
        trialEndsAt: p.trialEndsAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async findByAccountId(accountId: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { accountId },
      orderBy: { createdAt: "desc" }, // most recent subscription
    });
    return row ? this.toEntity(row) : null;
  }

  async findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    return row ? this.toEntity(row) : null;
  }

  async findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { stripeCustomerId },
      orderBy: { createdAt: "desc" },
    });
    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: any): Subscription {
    return Subscription.rehydrate({
      ...row,
      status: row.status as SubscriptionStatus,
      plan: row.plan as Plan,
    });
  }
}
