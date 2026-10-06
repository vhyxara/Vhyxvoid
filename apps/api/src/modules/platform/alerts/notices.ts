// Account notices that need no alert rule: monthly usage at 80 % / 100 % of
// the plan, and a trial about to end. Sent to the account's owners and admins
// (in-app + email), exactly once each: inserting an AccountNotice row claims
// the notice, so concurrent API instances and the Stripe trial_will_end
// webhook never double-send. Runs every 15 minutes under the "notices" lease.
// Operators switch them in the console (billing.usageNotices, billing.trialNoticeDays).
import { Prisma, type PrismaClient } from "@/generated/prisma";
import { RoleLevel } from "@/core/constant/account.constant";
import { NotificationType } from "@/modules/notification/domain/enums";
import type { NotificationService } from "@/modules/notification/application/use-cases";
import { PLAN_LIMITS, currentPlanOverrides, getEffectivePlanLimitsForAccount, readSetting } from "@vhyxvoid/shared";

export const USAGE_NOTICE_LEVELS = [100, 80] as const;
const DAY_MS = 86_400_000;

/** The highest notice level `used` has reached, or null (unlimited plans never notify). */
export function usageNoticeLevel(used: number, limit: number): (typeof USAGE_NOTICE_LEVELS)[number] | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const pct = (used / limit) * 100;
  return USAGE_NOTICE_LEVELS.find((l) => pct >= l) ?? null;
}

export function monthKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Claims a notice. True only for the first caller for (account, kind, period). */
export async function claimNotice(prisma: PrismaClient, accountId: string, kind: string, period: string): Promise<boolean> {
  const res = await prisma.accountNotice.createMany({ data: [{ accountId, kind, period }], skipDuplicates: true });
  return res.count === 1;
}

const appUrl = () => (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");

async function recipients(prisma: PrismaClient, accountId: string) {
  const rows = await prisma.accountMember.findMany({
    where: { accountId, roleLevel: { gte: RoleLevel.ADMIN }, user: { deletedAt: null } },
    select: { user: { select: { id: true, email: true, firstName: true } } },
  });
  return rows.map((r) => r.user);
}

export async function sendUsageNotice(
  prisma: PrismaClient,
  svc: NotificationService,
  account: { id: string; name: string | null },
  level: number,
  used: number,
  limit: number,
): Promise<void> {
  const title = level >= 100 ? "You have used this month's requests" : `${level}% of this month's requests used`;
  const message =
    level >= 100
      ? `${account.name ?? "Your workspace"} has made ${used.toLocaleString("en-US")} requests this month, the ${limit.toLocaleString("en-US")} included in its plan. Tunnels keep working; upgrade for a higher limit.`
      : `${account.name ?? "Your workspace"} has made ${used.toLocaleString("en-US")} of the ${limit.toLocaleString("en-US")} requests included in its plan this month.`;
  const path = `/organizations/${account.id}/billing`;
  const users = await recipients(prisma, account.id);
  await Promise.allSettled(
    users.flatMap((u) => [
      svc.createInApp.execute({ userId: u.id, accountId: account.id, type: NotificationType.SYSTEM_ALERT, title, body: message, actionUrl: path, metadata: { notice: `USAGE_${level}` } }),
      svc.sendAlert.execute({ to: u.email, kind: "EVENT", title, message, accountName: account.name ?? "your workspace", ruleName: "Plan usage", url: `${appUrl()}${path}` }),
    ]),
  );
}

/** Trial reminder to owners and admins; claimed per trial end date so it goes out once. */
export async function sendTrialEndingNotice(prisma: PrismaClient, svc: NotificationService, accountId: string, trialEndsAt: Date, now = Date.now()): Promise<boolean> {
  if (!(await claimNotice(prisma, accountId, "TRIAL_ENDING", trialEndsAt.toISOString().slice(0, 10)))) return false;
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
  const daysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / DAY_MS));
  const title = daysLeft <= 0 ? "Your trial ends today" : `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const users = await recipients(prisma, accountId);
  await Promise.allSettled(
    users.flatMap((u) => [
      svc.createInApp.execute({
        userId: u.id,
        accountId,
        type: NotificationType.TRIAL_ENDING,
        title,
        body: `Add a payment method to keep your plan after ${trialEndsAt.toUTCString().slice(0, 16)}.`,
        actionUrl: `/organizations/${accountId}/billing`,
        metadata: { notice: "TRIAL_ENDING" },
      }),
      svc.sendTrialEnding.execute({ to: u.email, firstName: u.firstName ?? "", accountName: account?.name ?? "your workspace", trialEndsAt, daysLeft, accountId }),
    ]),
  );
  return true;
}

export async function runAccountNotices(
  prisma: PrismaClient,
  svc: NotificationService | undefined,
  now = Date.now(),
): Promise<{ usage: number; trial: number }> {
  if (!svc) return { usage: 0, trial: 0 };
  let usage = 0;
  let trial = 0;

  if (await readSetting("billing.usageNotices")) {
    const d = new Date(now);
    const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const overrides = await currentPlanOverrides();
    // Cheapest possible limit for any plan (after console overrides): accounts below
    // 80 % of it cannot have reached a notice unless they carry their own override.
    const minLimit = Math.min(
      ...Object.keys(PLAN_LIMITS).map((p) => {
        const o = (overrides as Record<string, { maxRequestsPerMonth?: number | null } | undefined>)?.[p]?.maxRequestsPerMonth;
        const v = o === undefined ? PLAN_LIMITS[p as keyof typeof PLAN_LIMITS].maxRequestsPerMonth : o === null ? Infinity : o;
        return v;
      }),
    );
    const rows = await prisma.usageAggregate.groupBy({ by: ["accountId"], where: { metric: "requests", periodStart: { gte: monthStart } }, _sum: { quantity: true } });
    const used = new Map(rows.map((r) => [r.accountId, Number(r._sum.quantity ?? 0)]));
    const ids = [...used.keys()].filter(Boolean);
    const overridden = new Set(
      ids.length
        ? (await prisma.account.findMany({ where: { id: { in: ids }, limitOverrides: { not: Prisma.DbNull } }, select: { id: true } })).map((a) => a.id)
        : [],
    );
    const candidates = ids.filter((id) => overridden.has(id) || (Number.isFinite(minLimit) && used.get(id)! >= minLimit * 0.8));
    const period = monthKey(now);
    for (const accountId of candidates) {
      try {
        const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, overrides);
        const level = usageNoticeLevel(used.get(accountId)!, limits.maxRequestsPerMonth);
        if (!level) continue;
        // Claim every level reached, so an account that jumps past 100 % gets one notice, not two.
        const claimed = await Promise.all(USAGE_NOTICE_LEVELS.filter((l) => l <= level).map((l) => claimNotice(prisma, accountId, `USAGE_${l}`, period)));
        if (!claimed[0]) continue;
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, status: true } });
        if (!account || account.status === "DELETED") continue;
        await sendUsageNotice(prisma, svc, account, level, used.get(accountId)!, limits.maxRequestsPerMonth);
        usage++;
      } catch (err) {
        console.error({ err: (err as Error).message, accountId }, "[notices] usage notice failed");
      }
    }
  }

  const days = Number(await readSetting("billing.trialNoticeDays"));
  if (days > 0) {
    const subs = await prisma.subscription.findMany({
      where: { status: "TRIALING", trialEndsAt: { gt: new Date(now), lte: new Date(now + days * DAY_MS) } },
      select: { accountId: true, trialEndsAt: true },
      take: 500,
    });
    for (const s of subs) {
      try {
        if (s.trialEndsAt && (await sendTrialEndingNotice(prisma, svc, s.accountId, s.trialEndsAt, now))) trial++;
      } catch (err) {
        console.error({ err: (err as Error).message, accountId: s.accountId }, "[notices] trial notice failed");
      }
    }
  }
  return { usage, trial };
}
