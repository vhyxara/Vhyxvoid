import { httpClient } from '@/api/wrapper/http'

// ── Custom domains ────────────────────────────────────────────────────────────

export type DomainStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DNS_NOT_POINTING'

export type CustomDomain = {
  id: string
  hostname: string
  label: string
  status: DomainStatus
  verifiedAt: string | null
  routingOk: boolean
  lastCheckedAt: string | null
  lastError: string | null
  createdAt: string
  url: string
  records: {
    verification: { type: 'TXT'; name: string; value: string }
    routing: { type: 'CNAME'; name: string; value: string } | null
  }
  found?: { txt: string[]; cname: string[]; addresses: string[] }
}

export type DomainsOverview = {
  available: boolean
  target: string
  maxDomains: number
  canManage: boolean
  tunnelLabels: string[]
  domains: CustomDomain[]
}

const dom = (accountId: string) => `/domains/${encodeURIComponent(accountId)}`

export const domainsService = {
  overview: (accountId: string) => httpClient<DomainsOverview>({ url: dom(accountId), method: 'GET' }),
  add: (accountId: string, hostname: string, label: string) => httpClient<CustomDomain>({ url: dom(accountId), method: 'POST', data: { hostname, label } }),
  move: (accountId: string, id: string, label: string) => httpClient<CustomDomain>({ url: `${dom(accountId)}/${id}`, method: 'PATCH', data: { label } }),
  check: (accountId: string, id: string) => httpClient<CustomDomain>({ url: `${dom(accountId)}/${id}/check`, method: 'POST' }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${dom(accountId)}/${id}`, method: 'DELETE' })
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export type AlertType = 'TUNNEL_OFFLINE' | 'ERROR_RATE' | 'USAGE' | 'INBOX_FAILED' | 'DOMAIN'

export type AlertRule = {
  id: string
  name: string
  type: AlertType
  enabled: boolean
  label: string | null
  threshold: number | null
  windowMinutes: number | null
  minRequests: number | null
  notifyMembers: boolean
  emails: string[]
  webhookUrl: string | null
  description: string
  firing?: Array<{ subject: string; since: string }>
  createdAt: string
}

export type AlertEvent = {
  id: string
  ruleId: string
  ruleName?: string
  subject: string
  kind: 'FIRING' | 'RESOLVED' | 'EVENT'
  title: string
  message: string
  deliveries: Record<string, unknown> | null
  createdAt: string
}

export type AlertsOverview = {
  available: boolean
  maxRules: number
  canManage: boolean
  tunnelLabels: string[]
  rules: AlertRule[]
  events: AlertEvent[]
}

export type AlertRuleInput = Partial<Omit<AlertRule, 'id' | 'description' | 'firing' | 'createdAt'>> & { type?: AlertType }

const al = (accountId: string) => `/alerts/${encodeURIComponent(accountId)}`

export const alertsService = {
  overview: (accountId: string) => httpClient<AlertsOverview>({ url: al(accountId), method: 'GET' }),
  create: (accountId: string, rule: AlertRuleInput) => httpClient<AlertRule>({ url: al(accountId), method: 'POST', data: rule }),
  update: (accountId: string, id: string, rule: AlertRuleInput) => httpClient<AlertRule>({ url: `${al(accountId)}/${id}`, method: 'PATCH', data: rule }),
  remove: (accountId: string, id: string) => httpClient<{ id: string }>({ url: `${al(accountId)}/${id}`, method: 'DELETE' }),
  test: (accountId: string, id: string) =>
    httpClient<{ suppressed: boolean; deliveries: Record<string, unknown> | null }>({ url: `${al(accountId)}/${id}/test`, method: 'POST' })
}
