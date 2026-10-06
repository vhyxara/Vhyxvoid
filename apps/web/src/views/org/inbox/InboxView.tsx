'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, SelectField, Skeleton, Switch, Tabs, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { inboxService, type InboxItem, type InboxStatus } from '@/api/infrastructure/services/inbox.service'
import { formatBytes, prettyBody } from '@/views/org/inspector/inspectorFormat'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

const keys = {
  all: (a: string) => ['inbox', a] as const,
  overview: (a: string) => ['inbox', a, 'overview'] as const,
  list: (a: string, l: string, s: string) => ['inbox', a, 'list', l, s] as const,
  detail: (a: string, l: string, id: string) => ['inbox', a, 'detail', l, id] as const
}

export function statusBadge(item: Pick<InboxItem, 'status' | 'responseStatus'>): { label: string; variant: 'success' | 'warning' | 'danger' | 'info' } {
  switch (item.status) {
    case 'DELIVERED':
      return { label: item.responseStatus ? `delivered · ${item.responseStatus}` : 'delivered', variant: item.responseStatus && item.responseStatus >= 400 ? 'warning' : 'success' }
    case 'FAILED':
      return { label: 'failed', variant: 'danger' }
    case 'DELIVERING':
      return { label: 'delivering', variant: 'info' }
    default:
      return { label: 'waiting', variant: 'info' }
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function Detail({ accountId, label, id, canManage, onGone }: { accountId: string; label: string; id: string; canManage: boolean; onGone: () => void }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const { data: r, isLoading, error } = useQuery({
    queryKey: keys.detail(accountId, label, id),
    queryFn: () => inboxService.detail(accountId, label, id),
    enabled: ready,
    refetchInterval: q => (q.state.data && (q.state.data.status === 'QUEUED' || q.state.data.status === 'DELIVERING') ? 3_000 : false)
  })
  const refresh = () => qc.invalidateQueries({ queryKey: keys.all(accountId) })
  const redeliver = useMutation({
    mutationFn: () => inboxService.redeliver(accountId, label, id),
    onSuccess: res => {
      toast.success(res.connected ? 'Delivering now' : 'Queued: it will be delivered when the tunnel is online')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const remove = useMutation({
    mutationFn: () => inboxService.remove(accountId, label, id),
    onSuccess: () => {
      toast.success('Deleted')
      onGone()
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })

  if (isLoading) return <Skeleton height='16rem' />
  if (error || !r) return <Alert variant='warning'>{(error as Error)?.message ?? 'Not found'}</Alert>

  const b = statusBadge(r)
  const body = r.body ? prettyBody(r.body, r.headers['content-type']) : null

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div style={{ minInlineSize: 0 }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <span style={{ ...mono, fontWeight: 700 }}>{r.method}</span>
            <span style={{ ...mono, wordBreak: 'break-all' }}>{r.path}</span>
            <Badge size='sm' variant={b.variant}>
              {b.label}
            </Badge>
          </div>
          <Typography variant='caption' style={muted}>
            Received {when(r.receivedAt)}
            {r.deliveredAt ? ` · delivered ${when(r.deliveredAt)}` : ''} · {r.attempts} attempt{r.attempts === 1 ? '' : 's'}
          </Typography>
        </div>
        {canManage && (
          <div className='flex gap-2'>
            <Button size='sm' icon={<i className='tabler-send' />} loading={redeliver.isPending} disabled={r.status === 'DELIVERING'} onClick={() => redeliver.mutate()}>
              {r.status === 'QUEUED' ? 'Deliver now' : 'Redeliver'}
            </Button>
            <Button size='sm' variant='ghost' loading={remove.isPending} disabled={r.status === 'DELIVERING'} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {r.lastError && r.status !== 'DELIVERED' && (
        <Alert variant={r.status === 'FAILED' ? 'danger' : 'warning'}>
          {r.lastError}
          {r.status === 'QUEUED' && new Date(r.nextAttemptAt).getTime() > Date.now() ? ` Next attempt ${when(r.nextAttemptAt)}.` : ''}
        </Alert>
      )}

      <section>
        <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
          Headers
        </Typography>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', inlineSize: '100%' }}>
            <tbody>
              {Object.entries(r.headers)
                .sort(([a], [z]) => a.localeCompare(z))
                .map(([k, v]) => (
                  <tr key={k} style={{ borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
                    <th scope='row' style={{ ...mono, textAlign: 'start', padding: '4px 12px 4px 0', fontWeight: 500, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {k}
                    </th>
                    <td style={{ ...mono, padding: '4px 0', wordBreak: 'break-all', ...(v === '[hidden]' ? muted : {}) }}>{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
          Body {r.body ? <span style={{ ...muted, fontWeight: 400 }}>· {formatBytes(r.body.size)}</span> : null}
        </Typography>
        {!body || body.kind === 'empty' ? (
          <Typography variant='body2' style={muted}>
            No body
          </Typography>
        ) : (
          <pre style={{ ...mono, margin: 0, padding: 12, maxBlockSize: 420, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 8, background: 'var(--vhyx-color-bg-muted)' }}>
            {body.text}
          </pre>
        )}
      </section>
    </div>
  )
}

export default function InboxView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const [label, setLabel] = useState<string | null>(null)
  const [status, setStatus] = useState<'ALL' | InboxStatus>('ALL')
  const [selected, setSelected] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')

  const overview = useQuery({ queryKey: keys.overview(accountId), queryFn: () => inboxService.overview(accountId), enabled: ready, refetchInterval: 5_000 })
  const tunnels = overview.data?.tunnels ?? []

  useEffect(() => {
    if (!label && tunnels.length) setLabel(tunnels[0].label)
  }, [label, tunnels])

  const list = useQuery({
    queryKey: keys.list(accountId, label ?? '', status),
    queryFn: () => inboxService.list(accountId, label!, status === 'ALL' ? undefined : status),
    enabled: ready && !!label,
    refetchInterval: 4_000,
    placeholderData: keepPreviousData
  })

  const toggle = useMutation({
    mutationFn: ({ l, enabled }: { l: string; enabled: boolean }) => inboxService.setEnabled(accountId, l, enabled),
    onSuccess: r => {
      toast.success(r.enabled ? `Inbox on for ${r.label}` : `Inbox off for ${r.label}`)
      setLabel(r.label)
      setNewLabel('')
      qc.invalidateQueries({ queryKey: keys.all(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })
  const purge = useMutation({
    mutationFn: (s: 'DELIVERED' | 'FAILED') => inboxService.purge(accountId, label!, s),
    onSuccess: r => {
      toast.success(`Deleted ${r.deleted}`)
      setSelected(null)
      qc.invalidateQueries({ queryKey: keys.all(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const current = tunnels.find(t => t.label === label)
  const o = overview.data
  const candidates = (o?.liveLabels ?? []).filter(l => !tunnels.some(t => t.label === l))

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Typography variant='h4'>Webhook inbox</Typography>
        <Typography variant='body2' style={muted}>
          When your agent is offline, webhooks sent to a tunnel with its inbox on are kept and delivered, in order, as soon as it reconnects. Senders get
          202 Accepted, so they do not retry or disable your endpoint.
        </Typography>
      </div>

      {overview.isLoading ? (
        <Skeleton height='12rem' />
      ) : overview.error ? (
        <Alert variant='danger'>{(overview.error as Error).message}</Alert>
      ) : !o ? null : !o.available ? (
        <Alert variant='info' title='Not included in your plan'>
          <Link href={`/organizations/${accountId}/billing`}>See your plan</Link>.
        </Alert>
      ) : (
        <>
          <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
            {tunnels.map(t => (
              <Card
                key={t.label}
                className='p-4'
                style={{ cursor: 'pointer', outline: t.label === label ? '2px solid var(--vhyx-color-accent)' : 'none' }}
                onClick={() => {
                  setLabel(t.label)
                  setSelected(null)
                }}
              >
                <div className='flex items-center justify-between gap-2'>
                  <span style={{ ...mono, fontWeight: 700 }}>{t.label}</span>
                  {o.canManage ? (
                    <span onClick={e => e.stopPropagation()}>
                      <Switch checked={t.enabled} onCheckedChange={v => toggle.mutate({ l: t.label, enabled: v })} aria-label={`Inbox for ${t.label}`} />
                    </span>
                  ) : (
                    <Badge size='sm' variant={t.enabled ? 'success' : 'default'}>
                      {t.enabled ? 'on' : 'off'}
                    </Badge>
                  )}
                </div>
                <Typography variant='caption' style={muted}>
                  {t.connected ? 'online' : 'offline'} · {t.queued} waiting · {t.delivered} delivered{t.failed ? ` · ${t.failed} failed` : ''}
                </Typography>
              </Card>
            ))}
            {o.canManage && (
              <Card className='p-4'>
                <div className='flex flex-col gap-2'>
                  {candidates.length ? (
                    <SelectField
                      name='newLabel'
                      label='Turn on for a tunnel'
                      size='sm'
                      value={newLabel}
                      onValueChange={setNewLabel}
                      options={candidates.map(l => ({ value: l, label: l }))}
                    />
                  ) : (
                    <TextField name='newLabel' label='Turn on for a tunnel (label)' size='sm' value={newLabel} onChange={e => setNewLabel(e.target.value.trim())} />
                  )}
                  <div>
                    <Button size='sm' disabled={!/^[A-Za-z0-9._-]{1,63}$/.test(newLabel)} loading={toggle.isPending} onClick={() => toggle.mutate({ l: newLabel, enabled: true })}>
                      Turn on
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>

          <Typography variant='caption' style={muted}>
            Up to {o.keepPerTunnel.toLocaleString()} waiting requests per tunnel · bodies up to {formatBytes(o.bodyLimitBytes)} · kept {o.retentionDays} days · an error from your
            app is retried up to {o.maxAttempts} times
          </Typography>

          {label && current && (
            <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', alignItems: 'start' }}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div className='flex flex-wrap items-center justify-between gap-2' style={{ padding: '8px 12px', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
                  <Tabs value={status} onValueChange={v => setStatus(v as typeof status)} variant='pills'>
                    <Tabs.List>
                      <Tabs.Trigger value='ALL'>All</Tabs.Trigger>
                      <Tabs.Trigger value='QUEUED'>Waiting</Tabs.Trigger>
                      <Tabs.Trigger value='DELIVERED'>Delivered</Tabs.Trigger>
                      <Tabs.Trigger value='FAILED'>Failed</Tabs.Trigger>
                    </Tabs.List>
                  </Tabs>
                  {o.canManage && (status === 'DELIVERED' || status === 'FAILED') && (
                    <Button size='xs' variant='ghost' loading={purge.isPending} onClick={() => purge.mutate(status)}>
                      Delete all {status === 'DELIVERED' ? 'delivered' : 'failed'}
                    </Button>
                  )}
                </div>
                <div style={{ maxBlockSize: '65vh', overflowY: 'auto' }}>
                  {list.isLoading ? (
                    <Skeleton height='10rem' />
                  ) : !list.data?.requests.length ? (
                    <Typography variant='body2' style={{ ...muted, padding: 12 }}>
                      {current.enabled ? 'Nothing here. Requests show up when the tunnel is offline.' : 'The inbox is off for this tunnel.'}
                    </Typography>
                  ) : (
                    list.data.requests.map(item => {
                      const b = statusBadge(item)

                      return (
                        <button
                          key={item.id}
                          type='button'
                          onClick={() => setSelected(item.id)}
                          aria-current={selected === item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '4.2rem 1fr auto',
                            gap: 8,
                            alignItems: 'center',
                            inlineSize: '100%',
                            textAlign: 'start',
                            padding: '8px 12px',
                            border: 0,
                            borderBlockEnd: '1px solid var(--vhyx-color-border)',
                            background: selected === item.id ? 'var(--vhyx-color-bg-muted)' : 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                            font: 'inherit'
                          }}
                        >
                          <span style={{ ...mono, fontWeight: 600 }}>{item.method}</span>
                          <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.path}>
                            {item.path}
                          </span>
                          <span className='flex items-center gap-2'>
                            <Badge size='sm' variant={b.variant}>
                              {b.label}
                            </Badge>
                            <span style={{ ...muted, fontSize: 12 }}>{when(item.receivedAt)}</span>
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              </Card>
              <Card className='p-4' style={{ minInlineSize: 0 }}>
                {selected ? (
                  <Detail key={selected} accountId={accountId} label={label} id={selected} canManage={o.canManage} onGone={() => setSelected(null)} />
                ) : (
                  <Typography variant='body2' style={muted}>
                    Select a request to see it.
                  </Typography>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
