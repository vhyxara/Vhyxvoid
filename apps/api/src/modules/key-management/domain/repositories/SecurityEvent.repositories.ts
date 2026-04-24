// ─────────────────────────────────────────────────────────────────────────────
// SECURITY EVENT REPOSITORY — fire and forget, never throws
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { SecurityEvent } from "@/modules/key-management/domain/entities/security.entities";
import { SecurityEventProps } from "@/core/types/api-key.types/securityEvent";
import { SecurityEventRepository } from "@/core/types/api-key.types/securityEventRepository";

export class PrismaSecurityEventRepository implements SecurityEventRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async createSilent(event: SecurityEvent): Promise<void> {
    try {
      const p = event.toPersistence();
      await this.prisma.securityEvent.create({
        data: {
          id: p.id,
          apiKeyId: p.apiKeyId,
          accountId: p.accountId,
          type: p.type,
          ip: p.ip,
          reason: p.reason,
          metadata: p.metadata as any,
          createdAt: p.createdAt,
        },
      });
    } catch {
      // Intentionally silent — security event failure must never affect the gateway response
      console.error("[SecurityEvent] Failed to write security event");
    }
  }

  async findByApiKey(apiKeyId: string, limit = 50): Promise<SecurityEvent[]> {
    const data = await this.prisma.securityEvent.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return data.map((d) =>
      SecurityEvent.rehydrate(d as unknown as SecurityEventProps),
    );
  }

  async findByAccount(
    accountId: string,
    limit = 100,
  ): Promise<SecurityEvent[]> {
    const data = await this.prisma.securityEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return data.map((d) =>
      SecurityEvent.rehydrate(d as unknown as SecurityEventProps),
    );
  }
}
