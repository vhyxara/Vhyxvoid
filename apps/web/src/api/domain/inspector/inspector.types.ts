// Mirrors packages/shared/src/inspector.ts (InspectedRequest), as the API returns it.

export type InspectedBody = { data: string | null; encoding: 'utf8' | 'base64' | null; size: number; truncated: boolean }

export type InspectedRequest = {
  id: string
  at: string
  label: string
  accountSlug: string
  host?: string
  method: string
  path: string
  clientIp: string | null
  request: { headers: Record<string, string>; body: InspectedBody }
  response: { status: number; headers: Record<string, string>; body: InspectedBody; streamed: boolean } | null
  durationMs: number | null
  error: string | null
  replayOf: string | null
  inboxId?: string | null
  ruleIds?: string[]
  /** A traffic rule answered (mock, injected error, redirect); the agent never saw it. */
  answeredByRule?: boolean
  /** Set when a hosted mock API answered (the app did not see it). */
  mock?: { endpointId: string; responseId: string; endpointName?: string; responseName?: string } | null
}

export type InspectedSummary = {
  id: string
  at: string
  method: string
  path: string
  status: number | null
  durationMs: number | null
  error: string | null
  replayOf: string | null
  inboxId?: string | null
  answeredByRule?: boolean
  /** Set when a hosted mock API answered (the app did not see it). */
  mock?: { endpointId: string; responseId: string; endpointName?: string; responseName?: string } | null
  requestSize: number
  responseSize: number
  contentType: string | null
}

export type InspectorOverview = {
  enabled: boolean
  /** The workspace's own capture switch. */
  capture: boolean
  /** Plan and feature allow the inspector (independent of `capture`). */
  available: boolean
  canManage: boolean
  keepPerTunnel: number
  bodyLimitBytes: number
  retentionHours: number
  tunnels: Array<{ label: string; lastAt: string }>
}
