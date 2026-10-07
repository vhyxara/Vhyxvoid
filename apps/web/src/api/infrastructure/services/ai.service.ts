import { httpClient } from '@/api/wrapper/http'
import type { MockEndpoint } from '@/api/infrastructure/services/mocks.service'
import type { Collection } from '@/api/infrastructure/services/apiClient.service'

// /api/v1/ai — AI assist (apps/api/src/modules/platform/ai/ai.routes.ts).
// Drafts are returned, never saved: the editor applies them.

export type AiStatus = {
  enabled: boolean
  configured: boolean
  available: boolean
  model: string | null
  used: number
  /** null: no monthly cap. */
  limit: number | null
  resetsAt: string
  plan: string
}

type Usage = { used: number; limit: number | null; resetsAt: string }
type Traffic = { groups: number; requests: number } | null

export type AiCollection = Pick<Collection, 'name' | 'description' | 'auth' | 'variables' | 'folders' | 'requests'>

const base = (accountId: string) => `/ai/${encodeURIComponent(accountId)}`

export const aiService = {
  status: (accountId: string) => httpClient<AiStatus>({ url: base(accountId), method: 'GET' }),
  mock: (accountId: string, data: { description?: string; trafficLabel?: string; mockId?: string }) =>
    httpClient<{ summary: string; endpoints: MockEndpoint[]; warnings: string[]; traffic: Traffic; usage: Usage }>({ url: `${base(accountId)}/mock`, method: 'POST', data, timeoutMs: 200_000 }),
  tests: (accountId: string, data: { description?: string; trafficLabel?: string; specId?: string; baseUrl?: string }) =>
    httpClient<{ summary: string; collection: AiCollection; warnings: string[]; traffic: Traffic; usage: Usage }>({ url: `${base(accountId)}/tests`, method: 'POST', data, timeoutMs: 200_000 })
}
