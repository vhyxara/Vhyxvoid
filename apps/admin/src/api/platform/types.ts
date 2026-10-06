// Response shapes of apps/api's /admin/* platform routes
// (apps/api/src/modules/platform). Dates arrive as ISO strings.

export type Page<T> = {
  items: T[]
  meta: { page: number; limit: number; total: number; totalPages: number }
  extra?: any
}

export type ListParams = {
  page?: number
  limit?: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  [filter: string]: string | number | boolean | undefined
}

export type Overview = {
  rangeDays: number
  users: { total: number; new: number }
  accounts: { total: number; byStatus: Record<string, number> }
  subscriptions: { active: number; byPlan: Array<{ plan: string; status: string; count: number }> }
  apiKeys: { active: number }
  tunnels: { connectedSessions: number; liveAgents: number | null; hubReachable: boolean }
  revenue: { paidCents: number }
  feedback: { open: number }
  series: { signups: Array<{ day: string; count: number }>; requests: Array<{ day: string; count: number }> }
}

export type ProbeStatus = 'ok' | 'degraded' | 'down' | 'unknown'
export type Probe = { status: ProbeStatus; latencyMs?: number; message?: string; details?: Record<string, any> }
export type SystemHealth = {
  status: ProbeStatus
  checkedAt: string
  api: { status: ProbeStatus; details: Record<string, any> }
  probes: Record<string, Probe>
}

export type AccountRow = {
  id: string
  name: string
  slug: string | null
  type: 'PERSONAL' | 'ORGANIZATION'
  status: string
  createdAt: string
  graceEndsAt: string | null
  stripeCustomerId: string | null
  createdBy: { id: string; email: string }
  members: number
  apiKeys: number
  subscription: { plan: string; status: string; currentPeriodEnd: string } | null
}

export type AccountDetail = AccountRow & {
  statusReason: string | null
  adminNotes: string | null
  limitOverrides: Record<string, unknown> | null
  createdBy: { id: string; email: string; firstName: string; lastName: string }
  members: Array<{ roleLevel: number; createdAt: string; role: { name: string }; user: { id: string; email: string; firstName: string; lastName: string; status: boolean } }>
  subscriptions: Array<{ id: string; plan: string; status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; stripeSubscriptionId: string; trialEndsAt: string | null }>
  invoices: Array<{ id: string; amountDue: number; amountPaid: number; currency: string; status: string; createdAt: string; hostedInvoiceUrl: string | null }>
  apiKeys: Array<{ id: string; keyId: string; name: string; environment: string; status: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; createdBy: { email: string } }>
  tunnelSessions: Array<{ id: string; agentId: string; label: string; status: string; connectedAt: string; disconnectedAt: string | null; metadata: any }>
  usage: { requestsThisMonth: number; since: string }
  limits: Record<string, any>
  securityEvents: SecurityEvent[]
  liveAgents: LiveAgent[] | null
}

export type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  status: boolean
  isEmailVerified: boolean
  failedLoginAttempts: number
  lockedUntil: string | null
  createdAt: string
  deletedAt: string | null
  accounts: number
  locked: boolean
}

export type UserDetail = Omit<UserRow, 'accounts' | 'locked'> & {
  accounts: Array<{ roleLevel: number; createdAt: string; role: { name: string }; account: { id: string; name: string; type: string; status: string; slug: string | null } }>
  activeSessions: Array<{ id: string; createdAt: string; expiresAt: string; ipAddress: string; userAgent: string }>
  keysCreated: number
  recentActivity: ActivityRow[]
  feedbackCount: number
}

export type ApiKeyRow = {
  id: string
  keyId: string
  name: string
  environment: string
  status: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  account: { id: string; name: string; slug: string | null }
  createdBy: { id: string; email: string }
  scopes: string[]
}

export type LiveAgent = {
  agentId: string
  accountId: string
  label: string
  agentVersion?: string
  ip?: string
  connectedAt: string
  lastSeenAt: string
  missedPings: number
  capabilities: string[]
  account?: { id: string; name: string; slug: string | null } | null
  url?: string | null
  inFlight?: number
  versionStatus?: 'current' | 'outdated' | 'unsupported' | 'unknown'
}

export type TunnelSessionRow = {
  id: string
  agentId: string
  label: string
  status: string
  connectedAt: string
  disconnectedAt: string | null
  hubInstanceId: string | null
  metadata: { agentVersion?: string; ip?: string } | null
  account: { id: string; name: string; slug: string | null }
  apiKey: { keyId: string; name: string }
}

export type BillingSummary = {
  rangeDays: number
  subscriptions: Array<{ plan: string; status: string; count: number }>
  revenue: { paidCents: number; paidInvoices: number; byDay: Array<{ day: string; cents: number }> }
  outstanding: { cents: number; invoices: number }
  pastDueAccounts: number
  trialsEndingIn7Days: number
  stripeConfigured: boolean
}

export type SubscriptionRow = {
  id: string
  plan: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
  createdAt: string
  stripeSubscriptionId: string
  stripeUrl: string
  account: { id: string; name: string; slug: string | null; status: string }
}

export type InvoiceRow = {
  id: string
  stripeInvoiceId: string
  amountDue: number
  amountPaid: number
  currency: string
  status: string
  createdAt: string
  paidAt: string | null
  hostedInvoiceUrl: string | null
  stripeUrl: string
  account: { id: string; name: string }
}

export type SecurityEvent = {
  id: string
  type: string
  ip: string | null
  reason: string | null
  createdAt: string
  account?: { id: string; name: string } | null
  apiKey?: { keyId: string; name: string } | null
}

export type ActivityRow = {
  id: string
  action: string
  resourceType: string
  resourceId: string | null
  ipAddress: string | null
  createdAt: string
  metadata: any
  user?: { id: string; email: string } | null
  account?: { id: string; name: string } | null
}

export type RequestRow = {
  id: string
  requestId: string
  method: string
  path: string
  status: number | null
  durationMs: number | null
  errorCode: string | null
  createdAt: string
  account: { id: string; name: string }
}

export type SettingView = {
  key: string
  group: string
  label: string
  description: string
  type: 'boolean' | 'number' | 'string' | 'text' | 'enum' | 'url' | 'email' | 'stringList' | 'json'
  value: unknown
  default: unknown
  isDefault: boolean
  public: boolean
  min?: number
  max?: number
  maxLength?: number
  options?: string[]
  updatedAt: string | null
}

export type SettingsResponse = {
  groups: Record<string, { label: string; description: string }>
  settings: SettingView[]
}

export type ContentRow = {
  id: string
  slug: string
  kind: string
  title: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version: number
  publishedAt: string | null
  updatedAt: string
}

export type ContentDetail = ContentRow & {
  data: any
  publishedData: any
  seoTitle: string | null
  seoDescription: string | null
  revisions: Array<{ id: string; version: number; title: string; note: string | null; createdAt: string }>
}

export type StripePriceLookup = {
  plan: 'PRO' | 'ENTERPRISE'
  id: string | null
  source: 'admin' | 'environment' | null
  price: { id: string; active: boolean; unitAmount: number | null; currency: string; interval: string | null; productName: string | null } | null
  error: string | null
}

export type BillingSetup = {
  mode: 'free' | 'paid'
  defaultPlan: 'FREE' | 'PRO' | 'ENTERPRISE'
  checkoutEnabled: boolean
  trialDays: number
  stripe: { configured: boolean; testMode: boolean }
  prices: StripePriceLookup[]
  plans: Array<{ plan: string; limits: Record<string, unknown> }>
  problems: string[]
}

export type CustomDomainRow = {
  id: string
  hostname: string
  label: string
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DNS_NOT_POINTING'
  verifiedAt: string | null
  routingOk: boolean
  lastCheckedAt: string | null
  lastError: string | null
  createdAt: string
  account: { id: string; name: string; slug: string }
}

