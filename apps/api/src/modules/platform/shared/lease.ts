// A lease in `job_leases` so that, with several API instances, exactly one
// runs a periodic job at a time. The holder renews by acquiring again before
// the lease expires; a crashed holder's lease simply runs out.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";

const INSTANCE = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** True when this instance holds `name` for the next `ttlMs`. */
export async function acquireLease(prisma: PrismaClient, name: string, ttlMs: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    INSERT INTO "job_leases" ("name", "holder", "expiresAt")
    VALUES (${name}, ${INSTANCE}, now() + make_interval(secs => ${ttlMs / 1000}))
    ON CONFLICT ("name") DO UPDATE SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "job_leases"."expiresAt" < now() OR "job_leases"."holder" = EXCLUDED."holder"
    RETURNING "holder"`;
  return rows.length === 1 && rows[0].holder === INSTANCE;
}

/** Gives up every lease this instance holds (graceful shutdown), so another instance takes over at once. */
export async function releaseLeases(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "job_leases" WHERE "holder" = ${INSTANCE}`.catch(() => 0);
}

const running = new Set<string>();

/**
 * Runs `job` once if this instance can hold the lease and is not already
 * running it. `wait` makes a caller (an operator's "run now") wait for a
 * tick in progress instead of giving up. Returns undefined when skipped.
 */
export async function runLeasedJob<T>(prisma: PrismaClient, name: string, ttlMs: number, job: () => Promise<T>, wait = false): Promise<T | undefined> {
  if (wait) for (let i = 0; i < 300 && running.has(name); i++) await new Promise((r) => setTimeout(r, 100));
  if (running.has(name)) return undefined;
  running.add(name);
  try {
    if (!(await acquireLease(prisma, name, ttlMs))) return undefined;
    return await job();
  } finally {
    running.delete(name);
  }
}

/** Runs `job` every `everyMs` on whichever instance holds the lease. */
export function leasedInterval(prisma: PrismaClient, name: string, everyMs: number, job: () => Promise<void>): { stop: () => void } {
  const tick = () =>
    runLeasedJob(prisma, name, everyMs * 2, job).catch((err) => {
      console.error({ err: (err as Error).message, job: name }, "[jobs] tick failed");
    });
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), Math.min(5_000, everyMs));
  first.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
