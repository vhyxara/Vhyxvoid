import { httpClient } from '@/api/wrapper/http'
import type { InspectedBody } from '@/api/domain/inspector/inspector.types'

export type InboxStatus = 'QUEUED' | 'DELIVERING' | 'DELIVERED' | 'FAILED'

export type InboxTunnel = { label: string; enabled: boolean; connected: boolean; queued: number; delivered: number; failed: number }
export type InboxOverview = {
  available: boolean
  keepPerTunnel: number
  retentionDays: number
  bodyLimitBytes: number
  maxAttempts: number
  canManage: boolean
  liveLabels: string[]
  tunnels: InboxTunnel[]
}
export type InboxItem = {
  id: string
  method: string
  path: string
  bodySize: number
  receivedAt: string
  status: InboxStatus
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  responseStatus: number | null
  deliveredAt: string | null
}
export type InboxDetail = InboxItem & { headers: Record<string, string>; body: InspectedBody | null }

const base = (accountId: string) => `/inbox/${encodeURIComponent(accountId)}`
const one = (accountId: string, label: string) => `${base(accountId)}/${encodeURIComponent(label)}`

export const inboxService = {
  overview: (accountId: string) => httpClient<InboxOverview>({ url: base(accountId), method: 'GET' }),
  setEnabled: (accountId: string, label: string, enabled: boolean) =>
    httpClient<{ label: string; enabled: boolean }>({ url: one(accountId, label), method: 'PUT', data: { enabled } }),
  list: (accountId: string, label: string, status?: InboxStatus) =>
    httpClient<{ label: string; requests: InboxItem[] }>({ url: one(accountId, label), method: 'GET', params: status ? { status } : {} }),
  detail: (accountId: string, label: string, id: string) => httpClient<InboxDetail>({ url: `${one(accountId, label)}/${id}`, method: 'GET' }),
  redeliver: (accountId: string, label: string, id: string) =>
    httpClient<{ id: string; connected: boolean }>({ url: `${one(accountId, label)}/${id}/redeliver`, method: 'POST' }),
  remove: (accountId: string, label: string, id: string) => httpClient<{ id: string }>({ url: `${one(accountId, label)}/${id}`, method: 'DELETE' }),
  purge: (accountId: string, label: string, status?: 'DELIVERED' | 'FAILED') =>
    httpClient<{ deleted: number }>({ url: one(accountId, label), method: 'DELETE', params: status ? { status } : {} })
}
