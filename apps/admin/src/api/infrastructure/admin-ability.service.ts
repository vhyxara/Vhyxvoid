import type { AdminAbilityCreateResponse, AdminAbilitySummary } from '@/api/domain/admin-abilities/admin-ability.types'
import { ADMIN_ABILITY_ENDPOINTS } from './admin-ability.endpoints'
import { httpClient } from '@/api/wrapper/http'

export type CreateAbilityDTO = {
  action: string
  category: string
  description?: string
}

export const adminAbilityService = {
  list: () =>
    httpClient<AdminAbilitySummary[]>({
      url: ADMIN_ABILITY_ENDPOINTS.LIST,
      method: 'GET'
    }),

  // Rejected with a 409 CONFLICT ("Ability already exists") for a duplicate
  // category+action pair -- confirmed by reading CreateAbilityUseCase
  // directly (findByAction() check before AdminAbility.create()).
  create: (data: CreateAbilityDTO) =>
    httpClient<AdminAbilityCreateResponse>({
      url: ADMIN_ABILITY_ENDPOINTS.CREATE,
      method: 'POST',
      data
    }),

  // Real hard delete (PrismaAdminAbilityRepository.delete() -> a genuine
  // `prisma.adminAbility.delete()`), not a soft deactivate -- confirmed by
  // reading the repository directly. Rejected with a 400 ("System abilities
  // cannot be deleted") when `canBeDeleted()` is false (isSystem: true).
  // No guard against an ability currently assigned to a role: the schema's
  // AdminRoleAbility -> AdminAbility relation is `onDelete: Cascade`
  // (schema.prisma), so deleting an assigned ability silently removes it
  // from every role that had it, with no warning or error from the API --
  // the UI's confirm-delete dialog states this explicitly rather than
  // implying a safe no-op.
  remove: (id: string) =>
    httpClient<void>({
      url: ADMIN_ABILITY_ENDPOINTS.DELETE(id),
      method: 'DELETE'
    })
}
