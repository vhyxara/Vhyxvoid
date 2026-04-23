// identity/domain/repositories/AdminAuditLogRepository.ts

import { AdminAuditLog } from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";

export interface AdminAuditLogRepository {
  // APPEND-ONLY - no updates or deletes
  save(log: AdminAuditLog): Promise<void>;

  findById(id: string): Promise<AdminAuditLog | null>;
  findByAdminId(
    adminId: string,
    limit?: number,
    offset?: number,
  ): Promise<AdminAuditLog[]>;
  findByAction(
    action: string,
    limit?: number,
    offset?: number,
  ): Promise<AdminAuditLog[]>;
  findByTargetId(
    targetId: string,
    limit?: number,
    offset?: number,
  ): Promise<AdminAuditLog[]>;
  findAll(limit?: number, offset?: number): Promise<AdminAuditLog[]>;

  countByAdminId(adminId: string): Promise<number>;
  countByAction(action: string): Promise<number>;
  countByTargetId(targetId: string): Promise<number>;
}
