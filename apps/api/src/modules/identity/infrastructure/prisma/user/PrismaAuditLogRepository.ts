import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { AuditLogData } from "@/modules/identity/domain/repositories/user/AuditLog.repositories";

export class PrismaAuditLogRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async create(data: AuditLogData): Promise<void> {
    await this.prisma.auditLog.create({ data });
  }
}
