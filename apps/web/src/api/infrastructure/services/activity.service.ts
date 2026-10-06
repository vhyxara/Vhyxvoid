import { httpClient } from '@/api/wrapper/http'
import type { ActivityItem } from '@/views/org/activity/activityFormat'

export type ActivityPage = { items: ActivityItem[]; nextBefore: string | null; canExport: boolean }

const base = (accountId: string) => `/activity/${encodeURIComponent(accountId)}`

export const activityService = {
  list: (accountId: string, q: { category: string; connections: boolean; before?: string }) =>
    httpClient<ActivityPage>({
      url: base(accountId),
      method: 'GET',
      params: { category: q.category, connections: String(q.connections), limit: 50, ...(q.before ? { before: q.before } : {}) }
    }),

  /** CSV comes back as a file, not the JSON envelope, so it is fetched directly with the same token. */
  exportCsv: async (accountId: string, days: number): Promise<Blob> => {
    const { getAccessToken } = await import('@/api/domain/identity/store/auth.store')
    const token = getAccessToken()
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''}${base(accountId)}/export?days=${days}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include'
    })

    if (!res.ok) throw new Error(res.status === 403 ? 'Only owners and admins can export activity' : `Export failed (${res.status})`)

    return res.blob()
  }
}
