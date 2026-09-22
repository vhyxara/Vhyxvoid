// One-off, defensive backfill for shared/decision.md, 2026-09-22, session S1.
//
// Before S1 the Stripe webhook left Account.graceEndsAt null on PAST_DUE
// accounts (context.md Known Risk #57, E7), and GracePeriodWorker only selects
// rows with `graceEndsAt <= now`. Any account that went PAST_DUE before the
// fix ships is therefore stuck with no deadline. This gives each one
// `updatedAt + 7 days` (the time it was last changed, i.e. roughly when it
// went PAST_DUE, plus the grace period).
//
// As of 2026-09-22 production has no such rows (every table was empty), so
// this is expected to report "nothing to do". Run it anyway before deploying
// S1 in case that has changed.
//
// DRY RUN BY DEFAULT: it only prints what it would do. Pass --apply to write.
// Read the output first: a row whose new deadline is already in the past will
// be suspended by GracePeriodWorker's immediate sweep the next time the api
// starts, so applying this can suspend real accounts at deploy.
//
//   cd apps/api
//   DATABASE_URL=<url> pnpm backfill:grace-ends-at            # dry run
//   DATABASE_URL=<url> pnpm backfill:grace-ends-at -- --apply # write

import { GRACE_PERIOD_MS } from "@/modules/billing/domain/enums";

type PrismaLike = {
  account: {
    findMany(args: any): Promise<Array<{ id: string; updatedAt: Date }>>;
    updateMany(args: any): Promise<{ count: number }>;
  };
};

export interface BackfillRow {
  accountId: string;
  graceEndsAt: Date;
  alreadyExpired: boolean;
  written: boolean;
}

export async function backfillGraceEndsAt(
  prisma: PrismaLike,
  opts: { apply: boolean; now?: Date },
): Promise<BackfillRow[]> {
  const now = opts.now ?? new Date();

  const stuck = await prisma.account.findMany({
    where: { status: "PAST_DUE", graceEndsAt: null },
    select: { id: true, updatedAt: true },
  });

  const rows: BackfillRow[] = [];
  for (const account of stuck) {
    const graceEndsAt = new Date(account.updatedAt.getTime() + GRACE_PERIOD_MS);
    let written = false;
    if (opts.apply) {
      // Re-check the conditions in the write so a webhook that sets a real
      // deadline (or an account that just paid) between the read and the write
      // is never overwritten.
      const result = await prisma.account.updateMany({
        where: { id: account.id, status: "PAST_DUE", graceEndsAt: null },
        data: { graceEndsAt },
      });
      written = result.count > 0;
    }
    rows.push({
      accountId: account.id,
      graceEndsAt,
      alreadyExpired: graceEndsAt.getTime() <= now.getTime(),
      written,
    });
  }
  return rows;
}

async function main() {
  const { PrismaClient } = await import("@/generated/prisma");
  const prisma = new PrismaClient();
  const apply = process.argv.includes("--apply");

  try {
    const rows = await backfillGraceEndsAt(prisma as unknown as PrismaLike, { apply });

    if (rows.length === 0) {
      console.log("No PAST_DUE accounts with a null graceEndsAt. Nothing to do.");
      return;
    }
    console.log(
      `${rows.length} PAST_DUE account(s) with a null graceEndsAt (${apply ? "APPLYING" : "dry run"}):`,
    );
    for (const r of rows) {
      console.log(
        `  ${r.accountId}  graceEndsAt -> ${r.graceEndsAt.toISOString()}` +
          (r.alreadyExpired ? "  (ALREADY PAST: the worker will suspend it on its next sweep)" : "") +
          (apply ? (r.written ? "  written" : "  skipped (changed meanwhile)") : ""),
      );
    }
    if (!apply) console.log("\nDry run only. Re-run with --apply to write.");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
