import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { AuditLogData } from "@/modules/identity/domain/repositories/user/AuditLog.repositories";

export class PrismaAuditLogRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  // async create(data: AuditLogData): Promise<void> {
  //   await this.prisma.auditLog.create({ data });
  // }
  // Prisma is confused by accountId being optional string vs undefined
  // Fix: cast or spread explicitly
  async create(data: AuditLogData): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...data,
        accountId: data.accountId ?? undefined,
      } as any, // safest fix here — AuditLogData is internally consistent
    });
  }
}
