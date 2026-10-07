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

export type AiMockDraft = { summary: string; endpoints: MockEndpoint[]; warnings: string[]; traffic: Traffic; usage: Usage }
export type AiTestsDraft = { summary: string; collection: AiCollection; warnings: string[]; traffic: Traffic; usage: Usage }
type DraftState<T> = { id: string; status: 'running' | 'done' | 'failed'; result?: T; error?: { message: string; statusCode: number } }

/** Drafts run in the background on the API (a proxy may not wait minutes for one response): start, then poll. */
async function draft<T>(accountId: string, kind: 'mock' | 'tests', data: object, pollMs = 2000, maxMs = 8 * 60_000): Promise<T> {
  const started = await httpClient<{ id: string }>({ url: `${base(accountId)}/${kind}`, method: 'POST', data })
  const until = Date.now() + maxMs

  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, pollMs))
    const s = await httpClient<DraftState<T>>({ url: `${base(accountId)}/drafts/${started.id}`, method: 'GET' })

    if (s.status === 'done' && s.result) return s.result
    if (s.status === 'failed') throw new Error(s.error?.message ?? 'AI assist failed; try again')
  }

  throw new Error('The draft is taking too long; try again with a shorter description')
}

export const aiService = {
  status: (accountId: string) => httpClient<AiStatus>({ url: base(accountId), method: 'GET' }),
  mock: (accountId: string, data: { description?: string; trafficLabel?: string; mockId?: string }) => draft<AiMockDraft>(accountId, 'mock', data),
  tests: (accountId: string, data: { description?: string; trafficLabel?: string; specId?: string; baseUrl?: string }) => draft<AiTestsDraft>(accountId, 'tests', data)
}
