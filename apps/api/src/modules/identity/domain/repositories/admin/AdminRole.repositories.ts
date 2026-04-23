// identity/domain/repositories/AdminRoleRepository.ts

import { AdminRole } from "@/modules/identity/domain/entities/admin/AdminRole.entities";

export interface AdminRoleRepository {
  save(role: AdminRole): Promise<void>;
  findById(id: string): Promise<AdminRole | null>;
  findByName(name: string): Promise<AdminRole | null>;
  findAll(filters?: {
    isActive?: boolean;
    isSystem?: boolean;
  }): Promise<AdminRole[]>;
  findByAdminId(adminId: string): Promise<AdminRole[]>;
  delete(id: string): Promise<void>;
}
