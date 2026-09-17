// GET /admin/identity/abilities's real response shape, confirmed by reading
// the route handler directly. Abilities is its own future screen (Screen
// 5, see the stub at app/(protected)/abilities) -- this type lives here now
// only because Roles' ability-assignment sub-view needs the full assignable
// list. Screen 5 should reuse this type rather than redefining it.
export type AdminAbilitySummary = {
  id: string
  action: string
  category: string
  description?: string
  isSystem: boolean
  isActive: boolean
}
