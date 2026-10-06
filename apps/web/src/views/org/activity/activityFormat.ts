// Turns an activity item into one readable sentence for the feed. Pure, so
// it's tested without a DOM. Unknown actions fall back to a tidy version of
// the action name, so a new server-side action never breaks the page.

export type ActivityCategory = 'members' | 'keys' | 'tunnels' | 'alerts' | 'other'

export type ActivityItem = {
  id: string
  at: string
  action: string
  category: ActivityCategory
  actor: { id: string; name: string; email: string } | null
  target?: { id: string; name: string; email: string } | null
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** Role levels as the API stores them (100 owner, 70 admin, 10 member). */
export function roleName(level: unknown): string | undefined {
  if (typeof level !== 'number') return undefined
  if (level >= 100) return 'owner'
  if (level >= 70) return 'admin'

  return 'member'
}

function duration(ms: unknown): string | undefined {
  if (typeof ms !== 'number' || ms < 0) return undefined
  const m = Math.round(ms / 60_000)

  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)

  if (h >= 48) return `${Math.round(h / 24)} days`

  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** "<what happened>" without the actor; the view puts the actor in front. */
export function describeActivity(item: ActivityItem): string {
  const m = item.metadata ?? {}
  const who = item.target?.name ?? s(m.email)
  const label = s(m.label) ?? (item.resourceType === 'Tunnel' ? s(item.resourceId) : undefined)
  const t = label ? ` ${label}` : ''

  switch (item.action) {
    case 'TUNNEL_CONNECTED':
      return `Tunnel${t} connected${s(m.key) ? ` with key ${m.key}` : ''}`
    case 'TUNNEL_DISCONNECTED':
      return `Tunnel${t} disconnected${duration(m.durationMs) ? ` after ${duration(m.durationMs)}` : ''}`
    case 'TUNNEL_EVICTED':
      return `Tunnel${t} was disconnected by the hub`
    case 'API_KEY_CREATED':
      return `created API key ${s(m.name) ?? s(m.keyId) ?? ''}`.trim()
    case 'API_KEY_REVOKED':
      return `revoked API key ${s(m.name) ?? s(m.keyId) ?? ''}${m.reason === 'member_removed' ? ' (its owner left)' : ''}`.trim()
    case 'API_KEY_ROTATED':
      return `rotated API key ${s(m.name) ?? s(m.keyId) ?? ''}`.trim()
    case 'ACCOUNT_INVITATION_SENT':
      return `invited ${s(m.email) ?? 'a new member'}${roleName(m.role) ? ` as ${roleName(m.role)}` : ''}`
    case 'ACCOUNT_INVITATION_CANCELED':
      return `canceled the invitation for ${s(m.email) ?? 'a member'}`
    case 'ACCOUNT_INVITATION_ACCEPTED':
      return 'joined the workspace'
    case 'ACCOUNT_MEMBER_REMOVED':
      return `removed ${who ?? 'a member'} from the workspace`
    case 'ACCOUNT_MEMBER_LEFT':
      return 'left the workspace'
    case 'ACCOUNT_MEMBER_ROLE_CHANGED':
      return roleName(m.newRoleLevel) ? `made ${who ?? 'a member'} ${roleName(m.newRoleLevel) === 'member' ? 'a member' : `an ${roleName(m.newRoleLevel)}`}` : `changed ${who ?? 'a member'}'s role`
    case 'ACCOUNT_OWNERSHIP_TRANSFERRED':
      return 'transferred ownership of the workspace'
    case 'ORGANIZATION_CREATED':
      return 'created the workspace'
    case 'ORGANIZATION_RENAMED':
      return `renamed the workspace${s(m.newName) ? ` to ${m.newName}` : ''}`
    case 'TUNNEL_ACCESS_UPDATED':
      return `changed access rules for${t}${m.password === 'set' ? ' (password on)' : m.password === 'removed' ? ' (password off)' : ''}`
    case 'TUNNEL_ACCESS_REMOVED':
      return `made${t} public again`
    case 'TUNNEL_SHARE_LINK_CREATED':
      return `created a share link for${t}`
    case 'TUNNEL_SHARE_LINKS_REVOKED':
      return `revoked the share links of${t}`
    case 'DOMAIN_ADDED':
      return `added custom domain ${s(m.hostname) ?? ''}${s(m.label) ? ` for ${m.label}` : ''}`.trim()
    case 'DOMAIN_MOVED':
      return `pointed a custom domain at ${s(m.label) ?? 'another tunnel'}`
    case 'DOMAIN_REMOVED':
      return 'removed a custom domain'
    case 'ALERT_RULE_CREATED':
      return `created alert ${s(m.name) ?? ''}`.trim()
    case 'ALERT_RULE_UPDATED':
      return m.enabled === false ? `paused alert ${s(m.name) ?? ''}`.trim() : m.enabled === true ? `resumed alert ${s(m.name) ?? ''}`.trim() : `changed alert ${s(m.name) ?? ''}`.trim()
    case 'ALERT_RULE_DELETED':
      return 'deleted an alert'
    case 'INBOX_SETTINGS_UPDATED':
      return `${m.enabled === false ? 'turned off' : m.enabled === true ? 'turned on' : 'changed'} the webhook inbox for${t}`
    case 'INBOX_REDELIVERED':
      return `redelivered a held webhook on${t}`
    case 'INBOX_CLEARED':
      return `cleared the webhook inbox of${t}`
    case 'REQUEST_REPLAYED':
      return `replayed a request on${t}`
    // Rows the tunnel-access, domain and inbox routes write themselves.
    case 'tunnel.access.updated':
      return `changed access rules for ${item.resourceId ?? 'a tunnel'}${m.password === 'set' ? ' (password on)' : m.password === 'removed' ? ' (password off)' : ''}`
    case 'tunnel.access.removed':
      return `made ${item.resourceId ?? 'a tunnel'} public again`
    case 'tunnel.access.share_link':
      return `created a share link for ${item.resourceId ?? 'a tunnel'}${typeof m.hours === 'number' ? ` (${m.hours} h)` : ''}`
    case 'tunnel.access.links_revoked':
      return `revoked the share links of ${item.resourceId ?? 'a tunnel'}`
    case 'custom_domain.added':
      return `added custom domain ${item.resourceId ?? ''}${s(m.label) ? ` for ${m.label}` : ''}`.trim()
    case 'custom_domain.moved':
      return `pointed ${item.resourceId ?? 'a custom domain'} at ${s(m.to) ?? 'another tunnel'}`
    case 'custom_domain.removed':
      return `removed custom domain ${item.resourceId ?? ''}`.trim()
    case 'tunnel.inbox.redeliver':
      return `redelivered a held webhook on ${item.resourceId ?? 'a tunnel'}`
    case 'tunnel.inbox.purged':
      return `cleared ${typeof m.count === 'number' ? `${m.count} ` : ''}held webhooks of ${item.resourceId ?? 'a tunnel'}`
    case 'AGENT_STOPPED':
      return `stopped the agent for${t}${s(m.version) ? ` (v${m.version})` : ''}`
    case 'TRAFFIC_RULES_UPDATED':
      return `changed the traffic rules of${t}${typeof m.count === 'number' ? ` (${m.count} rule${m.count === 1 ? '' : 's'})` : ''}`
    case 'MOCK_API_CREATED':
      return `created the mock API ${s(m.name) ?? ''}${s(m.label) ? ` (${m.label})` : ''}${m.fromOpenApi ? ' from an OpenAPI document' : ''}`.replace('  ', ' ')
    case 'MOCK_API_UPDATED':
      return `${m.enabled === false ? 'switched off' : m.enabled === true ? 'switched on' : 'changed'} the mock API ${s(m.name) ?? s(m.label) ?? ''}${typeof m.endpoints === 'number' ? ` (${m.endpoints} endpoint${m.endpoints === 1 ? '' : 's'})` : ''}`.trim()
    case 'MOCK_API_IMPORTED':
      return `${m.replace ? 'replaced the endpoints of' : 'imported OpenAPI endpoints into'} a mock API`
    case 'MOCK_API_DELETED':
      return 'deleted a mock API'
    case 'INSPECTOR_CAPTURE_CHANGED':
      return m.capture === false ? 'turned off request capture for the workspace' : 'turned on request capture for the workspace'
    case 'INSPECTOR_CLEARED':
      return `cleared captured requests of${t}`
    default:
      return item.action.toLowerCase().replace(/_/g, ' ')
  }
}

/** System events (no person behind them) read as a sentence of their own. */
export function isSystemEvent(item: ActivityItem): boolean {
  return !item.actor && item.action.startsWith('TUNNEL_') && ['TUNNEL_CONNECTED', 'TUNNEL_DISCONNECTED', 'TUNNEL_EVICTED'].includes(item.action)
}

export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86_400_000)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'

  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
