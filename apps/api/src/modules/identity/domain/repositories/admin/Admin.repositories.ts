// identity/domain/repositories/AdminUserRepository.ts
import { AdminUser } from "@/modules/identity/domain/entities/admin/AdminUser.entities";
export interface AdminUserRepository {
  save(admin: AdminUser): Promise<void>;
  findById(id: string): Promise<AdminUser | null>;
  findByEmail(email: string): Promise<AdminUser | null>;
  findAll(filters?: {
    isDeleted?: boolean;
    status?: boolean;
  }): Promise<AdminUser[]>;
  countTotal(): Promise<number>;
}
