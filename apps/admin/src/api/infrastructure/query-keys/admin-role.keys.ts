import { createQueryKeys } from '@vhyx/api-kit'

// GET /admin/identity/roles has zero query params at all (isActive: true is
// hardcoded server-side) -- one real query, adminRoleKeys.list().
export const adminRoleKeys = createQueryKeys('admin-roles')
