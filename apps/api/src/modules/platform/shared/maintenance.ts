// Hourly housekeeping (job lease "maintenance"): delete sign-in sessions that
// stopped being usable more than SESSION_PRUNE_AFTER_MS ago (audit M23: revoked
// and expired rows were never removed), and account notices from past months.
import type { PrismaClient } from "@/generated/prisma";
import { SESSION_PRUNE_AFTER_MS } from "@/core/constant/ttl.constant";

export async function runMaintenance(prisma: PrismaClient, now = Date.now()): Promise<{ sessions: number; adminSessions: number; notices: number }> {
  const cutoff = new Date(now - SESSION_PRUNE_AFTER_MS);
  const dead = { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }, { absoluteExpiresAt: { lt: cutoff } }] };
  const [sessions, adminSessions, notices] = await Promise.all([
    prisma.session.deleteMany({ where: dead }),
    prisma.adminSession.deleteMany({ where: dead }),
    // Claims only matter while their period can still fire (a month, a trial).
    prisma.accountNotice.deleteMany({ where: { createdAt: { lt: new Date(now - 120 * 86_400_000) } } }),
  ]);
  return { sessions: sessions.count, adminSessions: adminSessions.count, notices: notices.count };
}
