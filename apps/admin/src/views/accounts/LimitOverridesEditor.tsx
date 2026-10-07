'use client'

import { useEffect, useState } from 'react'

import { Alert, Button, Switch, Table, Text, TextField } from '@vhyxui/react'

// Mirrors packages/shared/src/settings.ts (numeric and boolean limits).
export const NUMERIC_LIMITS = [
  ['maxAgents', 'Concurrent agents'],
  ['maxMembers', 'Members'],
  ['maxApiKeys', 'API keys'],
  ['maxScopesPerKey', 'Scopes per key'],
  ['maxRequestsPerMonth', 'Requests / month (shown, not blocked)'],
  ['rateLimitPerMinute', 'SDK requests / minute / key'],
  ['publicPathRateLimitPerMinute', 'Public URL requests / minute'],
  ['analyticsRetentionDays', 'Analytics retention (days)'],
  ['inspectorRequests', 'Inspector: requests kept per tunnel (0 = off)'],
  ['inboxRequests', 'Webhook inbox: requests held per tunnel (0 = off)'],
  ['maxCustomDomains', 'Custom domains (needs the Custom domains switch below)'],
  ['maxAlertRules', 'Alert rules (0 = no alerts)'],
  ['maxTrafficRules', 'Traffic rules per tunnel (0 = none)'],
  ['maxMockApis', 'Mock APIs (0 = none)'],
  ['maxMockEndpoints', 'Endpoints per mock API'],
  ['maxApiCollections', 'API client collections (0 = API client off)'],
  ['maxApiCollectionRequests', 'Requests per collection'],
  ['apiClientSendsPerMinute', 'API client sends / minute'],
  ['maxLoadTestVus', 'Load test virtual users (0 = load tests off)'],
  ['maxLoadTestSeconds', 'Longest load test (seconds)'],
  ['maxLoadTestRps', 'Load test requests / second'],
  ['loadTestsPerDay', 'Load tests per day'],
  ['maxMonitors', 'Monitors (0 = none)'],
  ['minMonitorIntervalMinutes', 'Shortest monitor interval (minutes)'],
  ['maxApiSpecs', 'API docs specs (0 = none)'],
  ['maxTeamChannels', 'Chat channels (0 = team space off)'],
  ['maxTeamDocs', 'Team documents'],
  ['maxTeamIssues', 'Tracker issues'],
  ['teamHistoryDays', 'Chat history shown (days)'],
  ['aiRequestsPerMonth', 'AI assist drafts per month']
] as const

export const BOOLEAN_LIMITS = [
  ['prodKeysAllowed', 'Production keys'],
  ['rotationAllowed', 'Key rotation'],
  ['expiryAllowed', 'Key expiry'],
  ['accessRules', 'Tunnel access rules (password, IP allowlist, share links)'],
  ['customDomains', 'Custom domains'],
  ['protectedDocs', 'Password-protected API docs'],
  ['docsCustomDomains', 'API docs on a custom domain'],
  ['prioritySupport', 'Priority support']
] as const

type Overrides = Record<string, number | boolean | null>

/**
 * Edit a limit-override object: leave a field empty to keep the plan's value,
 * type "unlimited" for no limit. Used for one account and for whole plans.
 */
export function LimitOverridesEditor({ value, onSave, saving }: { value: Record<string, unknown> | null | undefined; onSave: (v: Overrides | null) => Promise<unknown>; saving?: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [flags, setFlags] = useState<Record<string, boolean | undefined>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d: Record<string, string> = {}
    const f: Record<string, boolean | undefined> = {}

    for (const [k] of NUMERIC_LIMITS) {
      const v = value?.[k]

      d[k] = v === null ? 'unlimited' : v === undefined ? '' : String(v)
    }
    for (const [k] of BOOLEAN_LIMITS) f[k] = typeof value?.[k] === 'boolean' ? (value[k] as boolean) : undefined
    setDraft(d)
    setFlags(f)
  }, [value])

  const build = (): Overrides | null => {
    const out: Overrides = {}

    for (const [k, label] of NUMERIC_LIMITS) {
      const raw = (draft[k] ?? '').trim().toLowerCase()

      if (!raw) continue
      if (raw === 'unlimited') out[k] = null
      else if (/^\d+$/.test(raw)) out[k] = Number(raw)
      else throw new Error(`${label}: enter a whole number or "unlimited"`)
    }
    for (const [k] of BOOLEAN_LIMITS) if (flags[k] !== undefined) out[k] = flags[k]!

    return Object.keys(out).length ? out : null
  }

  const save = async () => {
    setError(null)
    try {
      await onSave(build())
    } catch (e: any) {
      setError(e?.message ?? 'Could not save')
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <Text size='sm' tone='muted'>
        Empty keeps the plan&apos;s value. Type <code>unlimited</code> to remove a limit.
      </Text>
      <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))' }}>
        {NUMERIC_LIMITS.map(([k, label]) => (
          <TextField name={k} key={k} label={label} value={draft[k] ?? ''} placeholder='plan default' onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} size='sm' />
        ))}
      </div>
      <Table
        density='compact'
        data={BOOLEAN_LIMITS.map(([k, label]) => ({ id: k, label })) as any}
        columns={[
          { key: 'label', header: 'Feature' },
          {
            key: 'mode',
            header: 'Override',
            cell: (r: any) => (
              <div className='flex items-center gap-3'>
                <Switch checked={flags[r.id] ?? false} onCheckedChange={c => setFlags(f => ({ ...f, [r.id]: c }))} aria-label={r.label} />
                {flags[r.id] === undefined ? (
                  <Text size='xs' tone='muted'>
                    plan default
                  </Text>
                ) : (
                  <Button size='xs' variant='link' onClick={() => setFlags(f => ({ ...f, [r.id]: undefined }))}>
                    Use plan default
                  </Button>
                )}
              </div>
            )
          }
        ]}
      />
      {error && <Alert variant='danger'>{error}</Alert>}
      <div className='flex gap-2'>
        <Button loading={saving} onClick={save}>
          Save limits
        </Button>
        <Button variant='ghost' onClick={() => onSave(null)}>
          Clear all overrides
        </Button>
      </div>
    </div>
  )
}
