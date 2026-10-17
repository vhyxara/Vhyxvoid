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
  CustomDomainRow,
  ContactMessage,
  BlogCategoryRow,
  BlogPostDetail,
  BlogPostInput,
  BlogPostRow,
  BlogTagRow,
  MediaAsset,
  BlogAuthor,
  BlogAuthorInput,
  ChangelogEntry,
  ChangelogInput,
  NewsletterSubscriber,
  MediaUsage,
  SeoAudit,
  SeoLimits,
  SeoNotFoundRow,
  SeoPageRow,
  SeoRedirectRow
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
    httpClient<{ available: boolean; agents: LiveAgent[]; message?: string; versions?: Record<string, number>; outdated?: number; recommendedVersion?: string | null; minimumVersion?: string | null }>({ url: '/admin/tunnels/live', method: 'GET', params: { accountId } }),
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

  contactMessages: list<ContactMessage>('/admin/contact-messages'),
  setContactStatus: (id: string, status: ContactMessage['status']) => patch<ContactMessage>(`/admin/contact-messages/${id}`, { status }),
  deleteContactMessage: (id: string) => del(`/admin/contact-messages/${id}`),

  previewLink: (kind: 'content' | 'post', id: string) => post<{ token: string; path: string; expiresAt: string }>(`/admin/preview/${kind}/${id}`),
  media: list<MediaAsset>('/admin/media'),
  uploadMedia: (file: File, alt = '') =>
    httpClient<MediaAsset>({
      url: '/admin/media',
      method: 'POST',
      data: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), 'x-alt': encodeURIComponent(alt) },
      timeoutMs: 120_000
    }),
  updateMedia: (id: string, body: { alt?: string; filename?: string }) => patch<MediaAsset>(`/admin/media/${id}`, body),
  mediaUsage: (id: string) => get<MediaUsage>(`/admin/media/${id}/usage`),
  deleteMedia: (id: string, force = false) => httpClient<{ id: string }>({ url: `/admin/media/${id}`, method: 'DELETE', params: { force: force || undefined } }),

  seoAudit: () => get<SeoAudit>('/admin/seo/audit'),
  seoPages: () => get<{ items: SeoPageRow[]; limits: SeoLimits }>('/admin/seo/pages'),
  saveSeoPage: (body: { path: string; title?: string; description?: string; imageUrl?: string; noindex: boolean }) => put<unknown>('/admin/seo/pages', body),
  seoRedirects: list<SeoRedirectRow>('/admin/seo/redirects'),
  createSeoRedirect: (body: { from: string; to: string; permanent: boolean; note?: string }) => post<SeoRedirectRow>('/admin/seo/redirects', body),
  updateSeoRedirect: (id: string, body: { from?: string; to?: string; permanent?: boolean; note?: string }) => patch<SeoRedirectRow>(`/admin/seo/redirects/${id}`, body),
  deleteSeoRedirect: (id: string) => del(`/admin/seo/redirects/${id}`),
  importSeoRedirects: (lines: string) => post<{ created: number; updated: number; errors: Array<{ line: number; message: string }> }>('/admin/seo/redirects/bulk', { lines }),
  seoNotFound: list<SeoNotFoundRow>('/admin/seo/not-found'),
  dismissSeoNotFound: (id: string) => del(`/admin/seo/not-found/${id}`),
  clearSeoNotFound: () => del<{ count: number }>('/admin/seo/not-found'),

  blogPosts: list<BlogPostRow>('/admin/blog/posts'),
  blogPost: (id: string) => get<BlogPostDetail>(`/admin/blog/posts/${id}`),
  createBlogPost: (body: BlogPostInput & { title: string }) => post<BlogPostDetail>('/admin/blog/posts', body),
  saveBlogPost: (id: string, body: BlogPostInput) => put<BlogPostDetail>(`/admin/blog/posts/${id}`, body),
  publishBlogPost: (id: string, publishAt?: string) => post<BlogPostDetail>(`/admin/blog/posts/${id}/publish`, publishAt ? { publishAt } : {}),
  unpublishBlogPost: (id: string) => post<BlogPostDetail>(`/admin/blog/posts/${id}/unpublish`),
  deleteBlogPost: (id: string) => del(`/admin/blog/posts/${id}`),
  blogCategories: () => get<BlogCategoryRow[]>('/admin/blog/categories'),
  blogTags: () => get<BlogTagRow[]>('/admin/blog/tags'),
  blogAuthors: () => get<BlogAuthor[]>('/admin/blog/authors'),
  createBlogAuthor: (body: BlogAuthorInput & { name: string }) => post<BlogAuthor>('/admin/blog/authors', body),
  updateBlogAuthor: (id: string, body: BlogAuthorInput) => patch<BlogAuthor>(`/admin/blog/authors/${id}`, body),
  deleteBlogAuthor: (id: string) => del(`/admin/blog/authors/${id}`),
  createBlogCategory: (body: { name: string; slug?: string; description?: string }) => post<BlogCategoryRow>('/admin/blog/categories', body),
  updateBlogCategory: (id: string, body: { name?: string; slug?: string; description?: string }) => patch<BlogCategoryRow>(`/admin/blog/categories/${id}`, body),
  deleteBlogCategory: (id: string) => del<{ id: string }>(`/admin/blog/categories/${id}`),
  createBlogTag: (body: { name: string; slug?: string }) => post<BlogTagRow>('/admin/blog/tags', body),
  updateBlogTag: (id: string, body: { name?: string; slug?: string }) => patch<BlogTagRow>(`/admin/blog/tags/${id}`, body),
  deleteBlogTag: (id: string) => del<{ id: string }>(`/admin/blog/tags/${id}`),
  mergeBlogTag: (id: string, into: string) => post<{ into: string; posts: number }>(`/admin/blog/tags/${id}/merge`, { into }),

  newsletter: list<NewsletterSubscriber>('/admin/newsletter'),
  deleteSubscriber: (id: string) => del(`/admin/newsletter/${id}`),
  sendPostToNewsletter: (postId: string, test = false) => post<{ recipients?: number; to?: string }>(`/admin/newsletter/posts/${postId}/send`, { test }),

  changelog: list<ChangelogEntry>('/admin/changelog'),
  createChangelog: (body: ChangelogInput & { title: string }) => post<ChangelogEntry>('/admin/changelog', body),
  updateChangelog: (id: string, body: ChangelogInput) => patch<ChangelogEntry>(`/admin/changelog/${id}`, body),
  deleteChangelog: (id: string) => del(`/admin/changelog/${id}`),

  setAdminPassword: (adminId: string, newPassword: string) => post(`/admin/identity/users/${adminId}/password`, { newPassword })
}

/** Downloads an admin CSV export (the auth header needs fetch, not a plain link). */
async function downloadCsv(path: string, filename: string) {
  const { getAdminAccessToken } = await import('@/api/domain/auth/auth.store')
  const base = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:9000/api/v1'
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${getAdminAccessToken()}` },
    credentials: 'include'
  })

  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadAdminAuditCsv(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()

  return downloadCsv(`/admin/logs/admin-audit.csv${qs ? `?${qs}` : ''}`, `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`)
}

export const downloadNewsletterCsv = () => downloadCsv('/admin/newsletter/export.csv', `newsletter-${new Date().toISOString().slice(0, 10)}.csv`)

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
