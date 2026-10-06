// Display helpers for the Agents card. Pure (tested without a DOM).

import type { AgentHealth, AgentVersionStatus } from '@/api/infrastructure/services/agents.service'

/** "45s", "12m", "3h 5m", "2d 4h". */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))

  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)

  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)

  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  const d = Math.floor(h / 24)

  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

/** "just now", "12s ago", "3m ago". */
export function sinceText(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)

  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`

  return `${Math.floor(s / 60)}m ago`
}

export const HEALTH: Record<AgentHealth, { label: string; variant: 'success' | 'warning' | 'danger'; help: string }> = {
  healthy: { label: 'Healthy', variant: 'success', help: 'Answering the hub’s pings.' },
  lagging: { label: 'Lagging', variant: 'warning', help: 'Missed a ping: a busy machine or a slow network.' },
  unresponsive: { label: 'Not responding', variant: 'danger', help: 'Missed several pings; the hub drops it soon if this continues.' }
}

export const VERSION_BADGE: Record<AgentVersionStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'default' } | null> = {
  current: null,
  outdated: { label: 'Update available', variant: 'warning' },
  unsupported: { label: 'Too old', variant: 'danger' },
  unknown: { label: 'Unknown version', variant: 'default' }
}

export const UPDATE_COMMAND = 'npm i -D @vhyxvoid/agent@latest'
