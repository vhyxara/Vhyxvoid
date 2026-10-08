// "Count, then create" under a plan limit, safe against parallel requests.
//
// Without it, N simultaneous creates all count the same number and all pass
// (seen 2026-10-08: 10 collections, 11 API keys and 10 specs on a plan that
// allows 3). The count and the insert run in one transaction holding a
// Postgres advisory lock for this workspace and kind, so creates of the same
// kind in the same workspace queue up and each sees the ones before it.
// Run the count and the create with `tx`, not the outer client: a waiter holds
// a pooled connection, and the lock holder must not need another one.
import type { Prisma, PrismaClient } from "@/generated/prisma";

export type Tx = Prisma.TransactionClient;

// D lets route files that type their client loosely (`db`) keep that type.
export async function lockedCreate<T, D = Tx>(prisma: unknown, accountId: string, kind: string, fn: (tx: D) => Promise<T>): Promise<T> {
  const lock = (tx: Tx) => lockForCreate(tx, accountId, kind);
  // Already inside a transaction: lock it, and the lock lasts until it ends.
  if (typeof (prisma as PrismaClient).$transaction !== "function") {
    await lock(prisma as Tx);
    return fn(prisma as D);
  }
  return (prisma as PrismaClient).$transaction(
    async (tx) => {
      await lock(tx);
      return fn(tx as D);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** Takes the same lock inside a transaction the caller already holds. */
export async function lockForCreate(tx: Tx, accountId: string, kind: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`create:${kind}:${accountId}`}, 0))`;
}
