import { createQueryKeys } from '@vhyx/api-kit'

// adminUserKeys.list({ status }) is the real server-backed query (GET
// /admin/identity/users' only real param). The table hook's client-side
// search/sort/page params are NOT part of this key -- unlike Members
// (apps/web), which folds its full FetchParams into the key because the
// server genuinely uses all of them, admin users only has one real server
// dimension, so only `status` belongs in the key; everything else is
// derived client-side from the same fetched batch (same reasoning as
// Invitations' exact-key-match precedent, internal-tools/user-frontend/
// context.md item 47). React Query's default partial-key matching means
// invalidating `adminUserKeys.all` (['admin-users']) still catches every
// status-keyed variant.
export const adminUserKeys = createQueryKeys<{ status?: boolean }>('admin-users')
