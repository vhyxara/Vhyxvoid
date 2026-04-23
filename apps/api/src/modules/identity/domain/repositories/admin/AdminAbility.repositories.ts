// identity/domain/repositories/AdminAbilityRepository.ts

import { AdminAbility } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";

export interface AdminAbilityRepository {
  save(ability: AdminAbility): Promise<void>;
  findById(id: string): Promise<AdminAbility | null>;
  findByAction(category: string, action: string): Promise<AdminAbility | null>;
  findAll(filters?: {
    isActive?: boolean;
    category?: string;
  }): Promise<AdminAbility[]>;
  findByRoleId(roleId: string): Promise<AdminAbility[]>;
  findByAdminId(adminId: string): Promise<AdminAbility[]>;
  delete(id: string): Promise<void>;
  adminHasAbility(adminId: string, ability: string): Promise<boolean>;
}
