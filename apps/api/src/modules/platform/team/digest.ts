// The team space email digest (leased job "teamDigest", hourly): each person
// with unread team notifications (mentions, replies, assignments) older than
// 30 minutes gets one email per workspace, at most once a day, unless they
// turned the digest off. Reading in the app first means no email.
import type { PrismaClient } from "@/generated/prisma";
import type { NotificationService } from "@/modules/notification/application/use-cases";

const QUIET_MS = 30 * 60_000;
const EVERY_MS = 20 * 3_600_000;
const LOOKBACK_MS = 7 * 86_400_000;
const MAX_ITEMS = 8;
const appUrl = () => (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");

export async function runTeamDigest(prisma: PrismaClient, notifications: NotificationService | undefined, now = Date.now()): Promise<{ sent: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = prisma as any;
  const since = new Date(now - LOOKBACK_MS);
  const pending: Array<{ userId: string; accountId: string }> = await db.notification.findMany({
    where: { type: { in: ["TEAM_MENTION", "TEAM_ASSIGNED", "TEAM_REPLY"] }, readAt: null, accountId: { not: null }, createdAt: { gte: since, lte: new Date(now - QUIET_MS) } },
    distinct: ["userId", "accountId"],
    select: { userId: true, accountId: true },
    take: 2000,
  });
  let sent = 0;
  for (const p of pending) {
    const pref = await db.teamMemberPref.findUnique({ where: { userId_accountId: { userId: p.userId, accountId: p.accountId } } });
    if (pref && !pref.emailDigest) continue;
    if (pref?.lastDigestAt && now - new Date(pref.lastDigestAt).getTime() < EVERY_MS) continue;
    const after = pref?.lastDigestAt && new Date(pref.lastDigestAt) > since ? new Date(pref.lastDigestAt) : since;
    const [items, user, account] = await Promise.all([
      db.notification.findMany({ where: { userId: p.userId, accountId: p.accountId, readAt: null, type: { in: ["TEAM_MENTION", "TEAM_ASSIGNED", "TEAM_REPLY"] }, createdAt: { gt: after, lte: new Date(now - QUIET_MS) } }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.user.findUnique({ where: { id: p.userId }, select: { email: true, firstName: true } }),
      db.account.findUnique({ where: { id: p.accountId }, select: { name: true, status: true } }),
    ]);
    if (!items.length || !user || !account || ["DELETED", "SUSPENDED"].includes(account.status)) continue;
    // Still a member? People who left don't get digests of their old workspace.
    if (!(await db.accountMember.findUnique({ where: { userId_accountId: { userId: p.userId, accountId: p.accountId } } }))) continue;
    try {
      if (notifications) {
        await notifications.sendTeamDigest.execute({
          to: user.email,
          firstName: user.firstName,
          accountName: account.name,
          items: items.slice(0, MAX_ITEMS).map((n: { title: string; body: string; actionUrl: string | null }) => ({ title: n.title, body: n.body, url: `${appUrl()}${n.actionUrl ?? `/organizations/${p.accountId}/team/chat`}` })),
          more: Math.max(0, items.length - MAX_ITEMS),
          url: `${appUrl()}/organizations/${p.accountId}/team/chat`,
          settingsUrl: `${appUrl()}/organizations/${p.accountId}/team/chat?settings=1`,
        });
      }
      await db.teamMemberPref.upsert({ where: { userId_accountId: { userId: p.userId, accountId: p.accountId } }, create: { userId: p.userId, accountId: p.accountId, lastDigestAt: new Date(now) }, update: { lastDigestAt: new Date(now) } });
      sent++;
    } catch (err) {
      console.warn({ err: (err as Error).message, userId: p.userId }, "[team] digest not sent");
    }
  }
  return { sent };
}
