import { httpClient } from '@/api/wrapper/http'

export type TunnelRule = { label: string; hasPassword: boolean; ipAllowlist: string[]; updatedAt: string; url: string | null }
export type TunnelAccessOverview = { planAllows: boolean; canManage: boolean; liveLabels: string[]; rules: TunnelRule[] }
export type ShareLink = { label: string; expiresAt: string; token: string; query: string; url: string | null }

const base = (accountId: string) => `/tunnel-access/${encodeURIComponent(accountId)}`
const one = (accountId: string, label: string) => `${base(accountId)}/${encodeURIComponent(label)}`

export const tunnelAccessService = {
  overview: (accountId: string) => httpClient<TunnelAccessOverview>({ url: base(accountId), method: 'GET' }),
  save: (accountId: string, label: string, body: { password?: string | null; ipAllowlist?: string[] }) =>
    httpClient<{ label: string; hasPassword: boolean; ipAllowlist: string[] }>({ url: one(accountId, label), method: 'PUT', data: body }),
  remove: (accountId: string, label: string) => httpClient<{ label: string }>({ url: one(accountId, label), method: 'DELETE' }),
  shareLink: (accountId: string, label: string, hours: number) =>
    httpClient<ShareLink>({ url: `${one(accountId, label)}/share-links`, method: 'POST', data: { hours } }),
  revokeLinks: (accountId: string, label: string) => httpClient<{ label: string }>({ url: `${one(accountId, label)}/revoke-links`, method: 'POST' })
}
