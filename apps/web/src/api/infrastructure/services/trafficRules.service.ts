import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/trafficRules.ts (the API validates with it).

export type RuleMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

export type RuleAction =
  | { type: 'mock'; status: number; headers?: Record<string, string>; body?: string }
  | { type: 'fail'; status: number; percent: number; body?: string }
  | { type: 'redirect'; status: 301 | 302 | 307 | 308; location: string }
  | { type: 'delay'; ms: number }
  | { type: 'rewrite'; to: string }
  | { type: 'requestHeaders'; set?: Record<string, string>; remove?: string[] }
  | { type: 'responseHeaders'; set?: Record<string, string>; remove?: string[] }

export type RuleActionType = RuleAction['type']

export type TrafficRule = {
  id: string
  name: string
  enabled: boolean
  when: 'always' | 'offline'
  match: { path: string; methods?: RuleMethod[]; header?: { name: string; value?: string } }
  action: RuleAction
  /** Server-made one-line description (read only). */
  summary?: string
}

export type TunnelRules = { label: string; version: number; updatedAt: string; rules: TrafficRule[] }

export type TrafficRulesOverview = {
  enabled: boolean
  maxRules: number
  canManage: boolean
  liveLabels: string[]
  tunnels: TunnelRules[]
}

export type RulePlan = {
  matched: string[]
  respond: { ruleId: string; kind: 'mock' | 'fail' | 'redirect'; status: number; headers: Record<string, string>; body: string } | null
  delayMs: number
  path: string
  setRequestHeaders: Record<string, string>
  removeRequestHeaders: string[]
  setResponseHeaders: Record<string, string>
  removeResponseHeaders: string[]
}

const base = (accountId: string) => `/traffic-rules/${encodeURIComponent(accountId)}`
const strip = (rules: TrafficRule[]) => rules.map(({ summary: _s, ...r }) => r)

export const trafficRulesService = {
  overview: (accountId: string) => httpClient<TrafficRulesOverview>({ url: base(accountId), method: 'GET' }),
  save: (accountId: string, label: string, rules: TrafficRule[], expectedVersion: number) =>
    httpClient<{ label: string; version: number; rules: TrafficRule[]; warning?: string }>({
      url: `${base(accountId)}/${encodeURIComponent(label)}`,
      method: 'PUT',
      data: { rules: strip(rules), expectedVersion }
    }),
  test: (accountId: string, label: string, req: { method: RuleMethod; path: string; headers?: Record<string, string>; online: boolean }, rules: TrafficRule[]) =>
    httpClient<RulePlan>({ url: `${base(accountId)}/${encodeURIComponent(label)}/test`, method: 'POST', data: { ...req, rules: strip(rules) } })
}
