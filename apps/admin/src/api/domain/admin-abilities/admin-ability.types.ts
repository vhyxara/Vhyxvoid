// GET /admin/identity/abilities's real response shape, confirmed by reading
// the route handler directly. Originally added during Screen 4 (Roles'
// ability-assignment sub-view needs the full assignable list); Screen 5
// (this file) extends it rather than redefining it.
//
// `description` corrected to `string | null` (Screen 5 session) -- the
// prior `description?: string` was never verified against the real entity;
// AdminAbilityProps types it `string | null` (AdminAbility.entities.ts),
// and the route handler passes `a.description` straight through with no
// coercion -- same latent bug class as AdminRoleSummary had before the
// Screen 4 fix.
export type AdminAbilitySummary = {
  id: string
  action: string
  category: string
  description: string | null
  isSystem: boolean
  isActive: boolean
}

// POST /admin/identity/abilities's real response, confirmed via curl
// against the live backend: CreateAbilityUseCase.execute() returns only
// {id, action, category} -- narrower than AdminAbilitySummary (omits
// description/isSystem/isActive), same pattern as adminRoleService.create()'s
// own narrow return type. Callers don't render this response directly (the
// dialog closes and the invalidated list re-fetches the full shape).
export type AdminAbilityCreateResponse = {
  id: string
  action: string
  category: string
}
