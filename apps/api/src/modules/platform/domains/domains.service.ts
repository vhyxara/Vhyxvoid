// Custom domains: claim, verify (TXT), check routing (CNAME / addresses), and
// tell the hub when routing changes. Rules: packages/shared/src/customDomains.ts.
import type { PrismaClient } from "@/generated/prisma";
import { checkCustomDomain, readSetting, verificationRecord, type DnsResolverLike } from "@vhyxvoid/shared";
import type { HubClient } from "../shared/hubClient";
import type { AlertService } from "../alerts/alerts.service";

export type DomainRow = {
  id: string;
  accountId: string;
  hostname: string;
  label: string;
  verificationToken: string;
  verifiedAt: Date | null;
  routingOk: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

export function domainStatus(d: Pick<DomainRow, "verifiedAt" | "routingOk">): "PENDING_VERIFICATION" | "ACTIVE" | "DNS_NOT_POINTING" {
  if (!d.verifiedAt) return "PENDING_VERIFICATION";
  return d.routingOk ? "ACTIVE" : "DNS_NOT_POINTING";
}

export class DomainService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dns: DnsResolverLike,
    private readonly hub: HubClient,
    private readonly alerts: AlertService,
  ) {}

  async target(): Promise<string> {
    return String((await readSetting("tunnels.customDomainTarget")) ?? "").trim().toLowerCase().replace(/\.$/, "");
  }

  /**
   * Re-reads DNS for one domain and stores the result. Verifying removes other
   * accounts' pending claims for the hostname. Returns the updated row and
   * what changed.
   */
  async check(domain: DomainRow): Promise<{ domain: DomainRow; verifiedNow: boolean; routingChanged: boolean; found: unknown; error: string | null }> {
    const target = await this.target();
    const result = await checkCustomDomain(this.dns, domain.hostname, domain.verificationToken, target);
    let verifiedNow = false;
    const data: Record<string, unknown> = { lastCheckedAt: new Date(), lastError: result.error, routingOk: result.routed };
    if (!domain.verifiedAt && result.verified) {
      const taken = await this.prisma.customDomain.findFirst({ where: { hostname: domain.hostname, verifiedAt: { not: null }, NOT: { id: domain.id } } });
      if (taken) {
        data.lastError = "This hostname is already verified by another workspace.";
      } else {
        data.verifiedAt = new Date();
        verifiedNow = true;
      }
    }
    let updated: DomainRow;
    try {
      updated = (await this.prisma.customDomain.update({ where: { id: domain.id }, data })) as DomainRow;
    } catch (err) {
      // Lost a race with another account verifying the same hostname (partial unique index).
      if ((err as { code?: string }).code === "P2002") {
        updated = (await this.prisma.customDomain.update({
          where: { id: domain.id },
          data: { lastCheckedAt: new Date(), lastError: "This hostname is already verified by another workspace.", routingOk: result.routed },
        })) as DomainRow;
        verifiedNow = false;
      } else throw err;
    }
    const routingChanged = Boolean(domain.verifiedAt) && domain.routingOk !== updated.routingOk;

    if (verifiedNow) {
      await this.prisma.customDomain.deleteMany({ where: { hostname: domain.hostname, verifiedAt: null, NOT: { id: domain.id } } });
      await this.hub.invalidateDomain(domain.hostname);
      await this.alerts
        .emitEvent(domain.accountId, "DOMAIN", {
          subject: domain.hostname,
          title: `${domain.hostname} is verified`,
          message: updated.routingOk
            ? `${domain.hostname} now serves the tunnel ${domain.label}.`
            : `${domain.hostname} is verified. Point it at ${target || "the platform"} to start serving the tunnel ${domain.label}.`,
          path: `/organizations/${domain.accountId}/domains`,
        })
        .catch(() => 0);
    } else if (routingChanged) {
      await this.alerts
        .emitEvent(domain.accountId, "DOMAIN", {
          subject: domain.hostname,
          title: updated.routingOk ? `${domain.hostname} points at us again` : `${domain.hostname} no longer points at us`,
          message: updated.routingOk
            ? `Requests to ${domain.hostname} reach the tunnel ${domain.label} again.`
            : `The DNS record of ${domain.hostname} no longer points at ${target}. Visitors cannot reach the tunnel ${domain.label} through it.`,
          path: `/organizations/${domain.accountId}/domains`,
        })
        .catch(() => 0);
    }
    return { domain: updated, verifiedNow, routingChanged, found: result.found, error: updated.lastError };
  }

  records(domain: Pick<DomainRow, "hostname" | "verificationToken">, target: string) {
    const txt = verificationRecord(domain.hostname, domain.verificationToken);
    return {
      verification: { type: "TXT", name: txt.name, value: txt.value },
      routing: target ? { type: "CNAME", name: domain.hostname, value: target } : null,
    };
  }
}
