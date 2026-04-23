// identity/application/usecases/admin/GetAdminAbilitiesUseCase.ts

import { PrismaUnitOfWork } from '@/modules/identity/infrastructure/prisma/PrismaUnitOfWork';

export class GetAdminAbilitiesUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(adminId: string): Promise<string[]> {
    // Super admin has all abilities
    const admin = await this.uow.adminUserRepository.findById(adminId);
    if (!admin) return [];

    if (admin.isSuperAdmin) {
      // Return all available abilities
      const allAbilities = await this.uow.adminAbilityRepository.findAll({ isActive: true });
      return allAbilities.map((a) => a.action);
    }

    // Get admin's roles
    const roles = await this.uow.adminRoleRepository.findByAdminId(adminId);

    const abilities = new Set<string>();

    for (const role of roles) {
      if (!role.isActive) continue;

      const roleAbilities = await this.uow.adminAbilityRepository.findByRoleId(role.id);

      for (const ability of roleAbilities) {
        if (ability.isActive) {
          abilities.add(ability.action);
        }
      }
    }

    return Array.from(abilities);
  }
}
