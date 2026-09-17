import { createQueryKeys } from '@vhyx/api-kit'

// GET /admin/identity/abilities has zero query params at all (isActive:
// true is hardcoded server-side) -- one real query, adminAbilityKeys.list().
export const adminAbilityKeys = createQueryKeys('admin-abilities')
