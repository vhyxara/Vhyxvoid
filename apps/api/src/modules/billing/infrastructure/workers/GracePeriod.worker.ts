// src/modules/billing/infrastructure/workers/GracePeriodWorker.ts
//
// Background worker that checks for accounts in PAST_DUE status
// where the grace period has expired and suspends them.
//
// Runs every hour. Never throws — always logs and continues.
// Register this in your billingPlugin after the Fastify setup.

import { PrismaClient } from "@/generated/prisma";

export class GracePeriodWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  start(): void {
    // Run once immediately, then every hour
    this.tick().catch(console.error);
    this.timer = setInterval(
      () => this.tick().catch(console.error),
      60 * 60 * 1_000,
    );
    console.info("[billing] GracePeriodWorker started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();

    // Find all PAST_DUE accounts where grace period has ended
    const expiredAccounts = await this.prisma.account.findMany({
      where: {
        status: "PAST_DUE",
        graceEndsAt: { lte: now },
      },
      select: { id: true, graceEndsAt: true },
    });

    if (expiredAccounts.length === 0) return;

    console.info(
      { count: expiredAccounts.length },
      "[billing] suspending accounts with expired grace period",
    );

    for (const account of expiredAccounts) {
      try {
        await this.prisma.account.update({
          where: { id: account.id },
          data: {
            status: "SUSPENDED",
            graceEndsAt: null,
            updatedAt: now,
          },
        });
        console.info(
          { accountId: account.id },
          "[billing] account suspended — grace period expired",
        );
      } catch (err) {
        console.error(
          { accountId: account.id, err },
          "[billing] failed to suspend account",
        );
      }
    }
  }
}
