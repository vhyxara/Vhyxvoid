// GET-only for now -- Admin Users' role-assignment sub-view needs the role
// list; full Roles CRUD (Screen 4) adds the rest of these paths when built.
export const ADMIN_ROLE_ENDPOINTS = {
  LIST: '/admin/identity/roles'
} as const
