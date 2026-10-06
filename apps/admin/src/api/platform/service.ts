import { httpClient } from '@/api/wrapper/http'
import type {
  AccountDetail,
  AccountRow,
  ActivityRow,
  ApiKeyRow,
  BillingSummary,
  ContentDetail,
  ContentRow,
  InvoiceRow,
  ListParams,
  LiveAgent,
  Overview,
  Page,
  RequestRow,
  SecurityEvent,
  SettingsResponse,
  SubscriptionRow,
  SystemHealth,
  TunnelSessionRow,
  UserDetail,
  UserRow,
  BillingSetup,
  CustomDomainRow
} from './types'

const list = <T>(url: string) => (params: ListParams = {}) =>
  httpClient<Page<T>>({ url, method: 'GET', params: params as Record<string, string | number | boolean | undefined> })

const get = <T>(url: string) => httpClient<T>({ url, method: 'GET' })
const post = <T>(url: string, data: unknown = {}) => httpClient<T>({ url, method: 'POST', data })
const patch = <T>(url: string, data: unknown) => httpClient<T>({ url, method: 'PATCH', data })
const put = <T>(url: string, data: unknown) => httpClient<T>({ url, method: 'PUT', data })
const del = <T>(url: string, data?: unknown) => httpClient<T>({ url, method: 'DELETE', data })

export const platformService = {
  overview: (days = 30) => httpClient<Overview>({ url: '/admin/overview', method: 'GET', params: { days } }),
  health: () => get<SystemHealth>('/admin/system/health'),
  traffic: (range: '1h' | '24h' | '7d') => httpClient<PlatformTraffic>({ url: '/admin/traffic', method: 'GET', params: { range } }),
  planLimits: () => get<{ builtIn: Record<string, any>; overrides: Record<string, any>; enforcement: Record<string, string> }>('/admin/system/plan-limits'),

  accounts: list<AccountRow>('/admin/accounts'),
  account: (id: string) => get<AccountDetail>(`/admin/accounts/${id}`),
  updateAccount: (id: string, body: Record<string, unknown>) => patch<{ id: string; status: string; disconnectedAgents: number }>(`/admin/accounts/${id}`, body),
  deleteAccount: (id: string, reason: string) => del<{ revokedKeys: number }>(`/admin/accounts/${id}`, { reason }),

  users: list<UserRow>('/admin/users'),
  user: (id: string) => get<UserDetail>(`/admin/users/${id}`),
  updateUser: (id: string, body: Record<string, unknown>) => patch<UserRow>(`/admin/users/${id}`, body),
  unlockUser: (id: string) => post(`/admin/users/${id}/unlock`),
  signOutUser: (id: string) => post<{ revokedSessions: number }>(`/admin/users/${id}/sign-out`),
  sendPasswordReset: (id: string) => post<{ email: string }>(`/admin/users/${id}/password-reset`),
  deleteUser: (id: string, reason: string) => del(`/admin/users/${id}`, { reason }),

  apiKeys: list<ApiKeyRow>('/admin/api-keys'),
  customDomains: list<CustomDomainRow>('/admin/domains'),
  removeCustomDomain: (id: string, reason: string) => del(`/admin/domains/${id}`, { reason }),
  runJob: (name: 'alerts' | 'domains' | 'notices' | 'maintenance') => post<{ job: string; result: unknown; ms: number }>(`/admin/system/jobs/${name}/run`),
  revokeApiKey: (id: string, reason: string) => post(`/admin/api-keys/${id}/revoke`, { reason }),

  liveTunnels: (accountId?: string) =>
    httpClient<{ available: boolean; agents: LiveAgent[]; message?: string }>({ url: '/admin/tunnels/live', method: 'GET', params: { accountId } }),
  disconnectAgent: (agentId: string, reason: string) => post(`/admin/tunnels/live/${agentId}/disconnect`, { reason }),
  tunnelSessions: list<TunnelSessionRow>('/admin/tunnels/sessions'),

  billingSetup: () => get<BillingSetup>('/admin/billing/setup'),
  billingSummary: (days = 30) => httpClient<BillingSummary>({ url: '/admin/billing/summary', method: 'GET', params: { days } }),
  subscriptions: list<SubscriptionRow>('/admin/billing/subscriptions'),
  invoices: list<InvoiceRow>('/admin/billing/invoices'),

  securityEvents: list<SecurityEvent>('/admin/logs/security-events'),
  activity: list<ActivityRow>('/admin/logs/activity'),
  requests: list<RequestRow>('/admin/logs/requests'),

  settings: () => get<SettingsResponse>('/admin/settings'),
  updateSettings: (changes: Record<string, unknown>) => patch<SettingsResponse>('/admin/settings', { changes }),

  content: list<ContentRow>('/admin/content'),
  contentEntry: (id: string) => get<ContentDetail>(`/admin/content/${id}`),
  createContent: (body: { slug: string; kind: string; title: string; data?: unknown }) => post<ContentDetail>('/admin/content', body),
  saveContent: (id: string, body: { title?: string; data?: unknown; seoTitle?: string | null; seoDescription?: string | null; expectedUpdatedAt?: string }) => put<ContentDetail>(`/admin/content/${id}`, body),
  publishContent: (id: string, note?: string) => post<ContentDetail>(`/admin/content/${id}/publish`, { note }),
  unpublishContent: (id: string, archive = false) => post<ContentDetail>(`/admin/content/${id}/unpublish`, { archive }),
  restoreRevision: (id: string, revisionId: string) => post(`/admin/content/${id}/revisions/${revisionId}/restore`),
  deleteContent: (id: string) => del(`/admin/content/${id}`),

  setAdminPassword: (adminId: string, newPassword: string) => post(`/admin/identity/users/${adminId}/password`, { newPassword })
}

/** Absolute URL of an admin export, for <a href download>. Auth header is added by fetch below. */
export async function downloadAdminAuditCsv(params: Record<string, string> = {}) {
  const { getAdminAccessToken } = await import('@/api/domain/auth/auth.store')
  const base = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:9000/api/v1'
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${base}/admin/logs/admin-audit.csv${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${getAdminAccessToken()}` },
    credentials: 'include'
  })

  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export type TrafficTotals = { requests: number; errors4xx: number; errors5xx: number; avgMs: number | null; errorRate: number | null }

export type PlatformTraffic = {
  range: '1h' | '24h' | '7d'
  from: string
  to: string
  bucketMinutes: number
  series: Array<{ t: string; requests: number; errors4xx: number; errors5xx: number; avgMs: number | null }>
  totals: TrafficTotals
  top: Array<TrafficTotals & { accountId: string; name: string | null; slug: string | null }>
}
