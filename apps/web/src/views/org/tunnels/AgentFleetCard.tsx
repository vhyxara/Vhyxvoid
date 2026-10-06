'use client'

// Connected agents of a workspace: health, version, uptime, current load and
// the key each one uses; owners and admins can stop one. An update note
// appears when agents run an older version than the platform recommends.

import { useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Skeleton, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { agentsService, type FleetAgent } from '@/api/infrastructure/services/agents.service'
import { HEALTH, UPDATE_COMMAND, VERSION_BADGE, formatUptime, sinceText } from './agentFleetFormat'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 12 } as const
const DOT: Record<FleetAgent['health'], string> = { healthy: 'var(--vhyx-color-success)', lagging: 'var(--vhyx-color-warning)', unresponsive: 'var(--vhyx-color-danger)' }

export const fleetKeys = { fleet: (accountId: string) => ['agent-fleet', accountId] as const }

export function AgentFleetCard({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const [showRecent, setShowRecent] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: fleetKeys.fleet(accountId), queryFn: () => agentsService.fleet(accountId), enabled: ready && !!accountId, refetchInterval: 15_000 })

  const stop = useMutation({
    mutationFn: (a: FleetAgent) => agentsService.stop(accountId, a.agentId),
    onSuccess: r => {
      toast.success(`Stopped ${r.label}. The agent exits and does not reconnect.`)
      void qc.invalidateQueries({ queryKey: fleetKeys.fleet(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.danger('Could not copy')
    }
  }

  return (
    <Card>
      <div className='flex flex-wrap justify-between items-start gap-3 mbe-4'>
        <div>
          <Typography variant='subtitle1'>Agents</Typography>
          <Typography variant='body2' style={muted}>
            Connected right now. Refreshes every 15 seconds.
          </Typography>
        </div>
        {data && (
          <div className='flex flex-wrap gap-2'>
            <Badge variant={data.summary.connected ? 'success' : 'default'} size='sm'>{`${data.summary.connected} connected`}</Badge>
            {data.summary.unhealthy > 0 && <Badge variant='warning' size='sm'>{`${data.summary.unhealthy} not healthy`}</Badge>}
            {data.summary.busy > 0 && <Badge variant='outline' size='sm'>{`${data.summary.busy} in flight`}</Badge>}
          </div>
        )}
      </div>

      {error ? (
        <Alert variant='warning'>Agents could not be loaded. {(error as Error).message}</Alert>
      ) : isLoading || !data ? (
        <Skeleton height='6rem' />
      ) : (
        <div className='flex flex-col gap-3'>
          {!data.hubReachable && <Alert variant='warning'>Live agent details are unavailable right now; tunnels themselves are not affected.</Alert>}

          {data.summary.outdated > 0 && (
            <Alert variant='warning' title={`${data.summary.outdated} agent${data.summary.outdated === 1 ? ' runs' : 's run'} an older version`}>
              Version {data.recommendedVersion} is recommended{data.minimumVersion ? `; agents older than ${data.minimumVersion} can no longer connect` : ''}. In each project, run{' '}
              <button type='button' onClick={() => copy(UPDATE_COMMAND, 'Command')} style={{ ...mono, background: 'var(--vhyx-color-bg-muted)', border: 0, borderRadius: 4, padding: '1px 6px', color: 'inherit', cursor: 'copy' }}>
                {UPDATE_COMMAND}
              </button>{' '}
              and restart the agent.
            </Alert>
          )}

          {data.agents.length === 0 ? (
            <div className='py-6 text-center flex flex-col items-center gap-2'>
              <i className='tabler-plug-x text-4xl' style={muted} aria-hidden />
              <Typography variant='body2'>No agents connected</Typography>
              <Typography variant='caption' style={muted}>
                Start one with <code style={mono}>npx @vhyxvoid/agent init</code>. Something wrong? <code style={mono}>npx @vhyxvoid/agent doctor --connect</code>
              </Typography>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.agents.map(a => {
                const h = HEALTH[a.health]
                const v = VERSION_BADGE[a.versionStatus]

                return (
                  <li key={a.agentId} className='flex flex-wrap items-start gap-3' style={{ padding: '12px 0', borderTop: '1px solid var(--vhyx-color-border)' }}>
                    <span
                      role='img'
                      aria-label={h.label}
                      title={`${h.label}: ${h.help}`}
                      style={{ inlineSize: 10, blockSize: 10, borderRadius: '50%', background: DOT[a.health], marginBlockStart: 6, flex: '0 0 10px' }}
                    />
                    <div style={{ flex: '1 1 220px', minInlineSize: 0 }}>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Typography variant='body2' style={{ fontWeight: 600, color: 'var(--vhyx-color-text)' }}>
                          {a.label}
                        </Typography>
                        <Badge size='sm' variant={h.variant}>
                          {h.label}
                        </Badge>
                        {v && (
                          <Badge size='sm' variant={v.variant}>
                            {v.label}
                          </Badge>
                        )}
                      </div>
                      {a.url && (
                        <button type='button' onClick={() => copy(a.url!, 'URL')} title='Copy URL' style={{ ...mono, ...muted, background: 'none', border: 0, padding: 0, cursor: 'copy', overflowWrap: 'anywhere', textAlign: 'start' }}>
                          {a.url}
                        </button>
                      )}
                    </div>
                    <dl className='grid gap-x-4 gap-y-1' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(6.5rem, 1fr))', flex: '2 1 360px', margin: 0, fontSize: 13 }}>
                      <Fact label='Version' value={a.version ? `v${a.version}` : '—'} />
                      <Fact label='Up for' value={formatUptime(a.uptimeSeconds)} />
                      <Fact label='Last ping' value={sinceText(a.lastSeenAt)} />
                      <Fact label='In flight' value={String(a.inFlight)} />
                      <Fact
                        label='Key'
                        value={a.key ? `${a.key.name}${a.key.expiresSoon ? ' (expires soon)' : ''}` : '—'}
                        warn={!!a.key?.expiresSoon}
                        href={a.key ? `/organizations/${accountId}/api-keys` : undefined}
                      />
                      {a.ip && <Fact label='From' value={a.ip} />}
                    </dl>
                    {data.canManage && (
                      <Button
                        size='sm'
                        variant='ghost'
                        loading={stop.isPending && stop.variables?.agentId === a.agentId}
                        onClick={() => {
                          if (window.confirm(`Stop the agent for ${a.label}? It exits on that machine and does not reconnect until someone starts it again. Requests to its URL fail meanwhile (or go to the webhook inbox / offline rules).`)) stop.mutate(a)
                        }}
                      >
                        Stop
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {data.recent.length > 0 && (
            <div>
              <button type='button' aria-expanded={showRecent} onClick={() => setShowRecent(s => !s)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'pointer', fontSize: 13 }}>
                {showRecent ? 'Hide' : 'Show'} {data.recent.length} disconnect{data.recent.length === 1 ? '' : 's'} in the last 24 hours
              </button>
              {showRecent && (
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, fontSize: 13 }}>
                  {data.recent.map(s => (
                    <li key={s.agentId} className='flex flex-wrap gap-x-3' style={{ padding: '4px 0', ...muted }}>
                      <span style={{ color: 'var(--vhyx-color-text)' }}>{s.label}</span>
                      <span>{s.status === 'EVICTED' ? 'dropped by the hub' : 'disconnected'}</span>
                      <span>{s.disconnectedAt ? new Date(s.disconnectedAt).toLocaleString() : ''}</span>
                      {s.durationSeconds !== null && <span>after {formatUptime(s.durationSeconds)}</span>}
                      {s.version && <span>v{s.version}</span>}
                      {s.key && <span>key {s.key.name}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Fact({ label, value, warn, href }: { label: string; value: string; warn?: boolean; href?: string }) {
  const style = { color: warn ? 'var(--vhyx-color-warning-text, var(--vhyx-color-warning))' : 'var(--vhyx-color-text)', overflowWrap: 'anywhere' as const }

  return (
    <div style={{ minInlineSize: 0 }}>
      <dt style={{ ...muted, fontSize: 11 }}>{label}</dt>
      <dd style={{ margin: 0, ...style }}>{href ? <Link href={href} style={style}>{value}</Link> : value}</dd>
    </div>
  )
}
