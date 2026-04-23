// identity/application/usecases/admin/VerifyAdminAbilityUseCase.ts

import { PrismaUnitOfWork } from '@/modules/identity/infrastructure/prisma/PrismaUnitOfWork';

/**
 * Check if an admin has a specific ability
 * Follows role hierarchy and caches results
 */
export class VerifyAdminAbilityUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(adminId: string, requiredAbility: string): Promise<boolean> {
    // Check admin exists
    const admin = await this.uow.adminUserRepository.findById(adminId);
    if (!admin) return false;

    // Super admin shortcut
    if (admin.isSuperAdmin) {
      return true;
    }

    return this.uow.adminAbilityRepository.adminHasAbility(adminId, requiredAbility);
  }
}
