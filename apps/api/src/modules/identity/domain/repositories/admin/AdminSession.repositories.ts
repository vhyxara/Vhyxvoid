// identity/domain/repositories/AdminSessionRepository.ts

import { AdminSession } from "@/modules/identity/domain/entities/admin/AdminSession.entities";

export interface AdminSessionRepository {
  save(session: AdminSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AdminSession | null>;
  revokeById(id: string): Promise<void>;
  revokeAllByAdminId(adminId: string): Promise<void>;
  countActiveByAdminId(adminId: string, now: Date): Promise<number>;
}
