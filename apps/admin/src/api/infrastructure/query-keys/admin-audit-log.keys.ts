import { createQueryKeys } from '@vhyx/api-kit'

import type { AuditLogQuery } from '@/api/infrastructure/admin-audit-log.service'

// Read-only, no mutations ever invalidate this -- keyed on the full query
// (filter + limit + offset) so switching the filter or paging refetches,
// same convention as adminUserKeys.list({status}).
export const adminAuditLogKeys = createQueryKeys<AuditLogQuery>('admin-audit-logs')
