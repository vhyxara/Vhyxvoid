// Re-checks custom domains in the background (job lease "domains", every
// 5 minutes): pending claims every 5 minutes for DOMAIN_PENDING_AUTOCHECK_DAYS
// (so a domain verifies by itself once DNS propagates), verified ones hourly
// (so a DNS change that breaks routing is noticed and alerted on).
import type { PrismaClient } from "@/generated/prisma";
import { DOMAIN_PENDING_AUTOCHECK_DAYS, readSetting } from "@vhyxvoid/shared";
import type { DomainRow, DomainService } from "./domains.service";

export async function runDomainChecks(prisma: PrismaClient, domains: DomainService, now = Date.now()): Promise<number> {
  if (!(await readSetting("features.customDomains"))) return 0;
  if (!(await domains.target())) return 0;
  const due = (await prisma.customDomain.findMany({
    where: {
      OR: [
        {
          verifiedAt: null,
          createdAt: { gte: new Date(now - DOMAIN_PENDING_AUTOCHECK_DAYS * 86_400_000) },
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - 4 * 60_000) } }],
        },
        { verifiedAt: { not: null }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now - 55 * 60_000) } }] },
      ],
    },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: 300,
  })) as DomainRow[];
  let checked = 0;
  for (const d of due) {
    try {
      await domains.check(d);
      checked++;
    } catch (err) {
      console.warn({ err: (err as Error).message, hostname: d.hostname }, "[domains] check failed");
    }
  }
  return checked;
}
