import { httpClient } from '@/api/wrapper/http'
import type { InspectedRequest, InspectedSummary, InspectorOverview } from '@/api/domain/inspector/inspector.types'

const base = (accountId: string) => `/inspector/${encodeURIComponent(accountId)}`

export const inspectorService = {
  overview: (accountId: string) => httpClient<InspectorOverview>({ url: base(accountId), method: 'GET' }),
  list: (accountId: string, label: string, limit = 100) =>
    httpClient<{ label: string; requests: InspectedSummary[] }>({
      url: `${base(accountId)}/${encodeURIComponent(label)}`,
      method: 'GET',
      params: { limit }
    }),
  detail: (accountId: string, label: string, id: string) =>
    httpClient<InspectedRequest>({ url: `${base(accountId)}/${encodeURIComponent(label)}/${id}`, method: 'GET' }),
  replay: (accountId: string, label: string, id: string) =>
    httpClient<{ replayed: string; status: number; durationMs: number }>({
      url: `${base(accountId)}/${encodeURIComponent(label)}/${id}/replay`,
      method: 'POST'
    }),
  clear: (accountId: string, label: string) => httpClient<{ cleared: boolean }>({ url: `${base(accountId)}/${encodeURIComponent(label)}`, method: 'DELETE' })
}
