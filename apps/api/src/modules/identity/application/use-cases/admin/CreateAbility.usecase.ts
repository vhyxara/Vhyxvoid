import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { AdminAbility } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";
import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { ConflictError } from "@/core/errors/error.format";

export class CreateAbilityUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    params: { action: string; category: string; description?: string },
    createdBy: string,
  ) {
    return this.uow.execute(
      async ({ adminAbilityRepository, adminAuditLogRepository }) => {
        const existing = await adminAbilityRepository.findByAction(
          params.category,
          params.action,
        );

        if (existing) {
          throw new ConflictError("Ability already exists");
        }

        const ability = AdminAbility.create({
          action: params.action,
          category: params.category,
          description: params.description,
        });

        await adminAbilityRepository.save(ability);

        const audit = AdminAuditLog.create({
          adminId: createdBy,
          action: AuditAction.ABILITY_CREATED,
          targetType: "AdminAbility",
          targetId: ability.id,
          changes: {
            before: null,
            after: ability.toPersistence(),
          },
        });

        await adminAuditLogRepository.save(audit);

        return {
          id: ability.id,
          action: ability.action,
          category: ability.category,
        };
      },
    );
  }
}
