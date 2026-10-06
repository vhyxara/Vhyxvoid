'use client'

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import { Alert, Badge, Button, Card, SelectField, Skeleton, Switch, Tabs, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import {
  useClearInspector,
  useInspectedRequest,
  useInspectorList,
  useInspectorOverview,
  useReplayRequest
} from '@/api/application/hooks/useInspector'
import type { InspectedRequest, InspectedSummary } from '@/api/domain/inspector/inspector.types'
import { formatBytes, prettyBody, statusVariant, toCurl } from './inspectorFormat'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function RequestRow({ r, active, onClick }: { r: InspectedSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-current={active}
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
        background: active ? 'var(--vhyx-color-bg-muted)' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit'
      }}
    >
      <span style={{ ...mono, fontWeight: 600 }}>{r.method}</span>
      <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.path}>
        {r.replayOf ? '↻ ' : ''}
        {r.path}
      </span>
      <span className='flex items-center gap-2'>
        <Badge size='sm' variant={statusVariant(r.status, r.error)}>
          {r.status ?? r.error ?? '—'}
        </Badge>
        <span style={{ ...muted, fontSize: 12, minInlineSize: 64, textAlign: 'end' }}>{timeOf(r.at)}</span>
      </span>
    </button>
  )
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const rows = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))

  if (!rows.length) return <Typography variant='body2' style={muted}>No headers</Typography>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', inlineSize: '100%' }}>
        <tbody>
          {rows.map(([k, v]) => (
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
  )
}

function Body({ body, contentType }: { body: InspectedRequest['request']['body']; contentType?: string }) {
  const pretty = prettyBody(body, contentType)

  if (pretty.kind === 'empty') return <Typography variant='body2' style={muted}>No body</Typography>

  return (
    <div className='flex flex-col gap-2'>
      <Typography variant='caption' style={muted}>
        {formatBytes(body.size)}
        {body.truncated ? ` · only the first ${formatBytes(body.data ? body.data.length : 0)} were kept` : ''}
      </Typography>
      <pre
        style={{
          ...mono,
          margin: 0,
          padding: 12,
          maxBlockSize: 420,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          borderRadius: 8,
          background: 'var(--vhyx-color-bg-muted)'
        }}
      >
        {pretty.text}
      </pre>
    </div>
  )
}

function Detail({ accountId, label, id }: { accountId: string; label: string; id: string }) {
  const { data: r, isLoading, error } = useInspectedRequest(accountId, label, id)
  const replay = useReplayRequest(accountId, label)

  if (isLoading) return <Skeleton height='20rem' />
  if (error || !r) return <Alert variant='warning'>{(error as Error)?.message ?? 'Request not found'}</Alert>

  const doReplay = () =>
    replay.mutate(r.id, {
      onSuccess: res => toast.success(`Replayed: ${res.status} in ${res.durationMs} ms`),
      onError: e => toast.danger((e as Error).message)
    })

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(toCurl(r))
      toast.success('curl command copied')
    } catch {
      toast.danger('Could not copy')
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div style={{ minInlineSize: 0 }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <span style={{ ...mono, fontWeight: 700 }}>{r.method}</span>
            <span style={{ ...mono, wordBreak: 'break-all' }}>{r.path}</span>
          </div>
          <Typography variant='caption' style={muted}>
            {new Date(r.at).toLocaleString()} · {r.durationMs ?? '—'} ms{r.clientIp ? ` · from ${r.clientIp}` : ''}
            {r.replayOf ? ' · replay' : ''}
          </Typography>
        </div>
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' icon={<i className='tabler-terminal-2' />} onClick={copyCurl}>
            Copy as curl
          </Button>
          <Button
            size='sm'
            icon={<i className='tabler-player-play' />}
            loading={replay.isPending}
            disabled={r.request.body.truncated}
            title={r.request.body.truncated ? 'The body was too large to keep, so it cannot be replayed exactly' : 'Send this request through the tunnel again'}
            onClick={doReplay}
          >
            Replay
          </Button>
        </div>
      </div>

      {r.error && (
        <Alert variant='danger'>
          {r.error === 'AGENT_TIMEOUT'
            ? 'Your local server did not answer in time.'
            : r.error === 'BACKEND_UNREACHABLE' || r.error === 'CONNECTION_REFUSED'
              ? 'The agent could not reach your local server. Is it running on the port the agent forwards to?'
              : `The request failed: ${r.error}`}
        </Alert>
      )}

      <Tabs defaultValue='request' variant='pills'>
        <Tabs.List>
          <Tabs.Trigger value='request'>Request</Tabs.Trigger>
          <Tabs.Trigger value='response'>Response {r.response ? <Badge size='sm' variant={statusVariant(r.response.status, null)}>{r.response.status}</Badge> : null}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value='request'>
          <div className='flex flex-col gap-4 mbs-3'>
            <section>
              <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>Headers</Typography>
              <HeadersTable headers={r.request.headers} />
            </section>
            <section>
              <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>Body</Typography>
              <Body body={r.request.body} contentType={r.request.headers['content-type']} />
            </section>
          </div>
        </Tabs.Content>
        <Tabs.Content value='response'>
          <div className='flex flex-col gap-4 mbs-3'>
            {!r.response ? (
              <Typography variant='body2' style={muted}>No response was received.</Typography>
            ) : (
              <>
                <section>
                  <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>Headers</Typography>
                  <HeadersTable headers={r.response.headers} />
                </section>
                <section>
                  <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>Body</Typography>
                  {r.response.streamed && (
                    <Typography variant='caption' style={{ ...muted, display: 'block', marginBlockEnd: 6 }}>
                      Streamed (chunked or server-sent events).
                    </Typography>
                  )}
                  <Body body={r.response.body} contentType={r.response.headers['content-type']} />
                </section>
              </>
            )}
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export default function InspectorView({ accountId }: { accountId: string }) {
  const [live, setLive] = useState(true)
  const [label, setLabel] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const overview = useInspectorOverview(accountId, live)
  const list = useInspectorList(accountId, label, live)
  const clear = useClearInspector(accountId, label ?? '')

  const tunnels = useMemo(() => overview.data?.tunnels ?? [], [overview.data])

  // Pick the most recently used tunnel when none is chosen yet.
  useEffect(() => {
    if (!label && tunnels.length) setLabel(tunnels[0].label)
  }, [label, tunnels])

  const requests = list.data?.requests ?? []

  useEffect(() => {
    if (selected && !requests.some(r => r.id === selected)) setSelected(null)
  }, [requests, selected])

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <Typography variant='h4'>Request inspector</Typography>
          <Typography variant='body2' style={muted}>
            Every request that reaches your tunnels, with headers and bodies. Replay one after you fix your code.
          </Typography>
        </div>
        <div className='flex items-center gap-4 flex-wrap'>
          {tunnels.length > 0 && (
            <div style={{ minInlineSize: 200 }}>
              <SelectField
                name='tunnel'
                label='Tunnel'
                size='sm'
                value={label ?? ''}
                onValueChange={v => {
                  setLabel(v)
                  setSelected(null)
                }}
                options={tunnels.map(t => ({ value: t.label, label: t.label }))}
              />
            </div>
          )}
          <label className='flex items-center gap-2'>
            <Switch checked={live} onCheckedChange={setLive} aria-label='Live updates' />
            <Typography variant='body2'>Live</Typography>
          </label>
        </div>
      </div>

      {overview.isLoading ? (
        <Skeleton height='16rem' />
      ) : overview.error ? (
        <Alert variant='danger'>{(overview.error as Error).message}</Alert>
      ) : !overview.data?.enabled ? (
        <Alert variant='info' title='The inspector is not available on this plan'>
          Requests still reach your tunnels; they are just not kept for inspection.{' '}
          <Link href={`/organizations/${accountId}/billing`}>See your plan</Link>.
        </Alert>
      ) : tunnels.length === 0 ? (
        <Card className='p-8'>
          <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
            <i className='tabler-radar-2' style={{ fontSize: 36, ...muted }} />
            <Typography variant='h6'>Waiting for the first request</Typography>
            <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
              Start a tunnel and send a request to its public URL. It shows up here within a few seconds, with its headers, body and your server&apos;s response.
            </Typography>
            <code style={{ ...mono, padding: '4px 8px', borderRadius: 6, background: 'var(--vhyx-color-bg-muted)' }}>npx @vhyxvoid/agent init</code>
          </div>
        </Card>
      ) : (
        <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', alignItems: 'start' }}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div className='flex items-center justify-between gap-2' style={{ padding: '10px 12px', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
              <Typography variant='body2' style={muted}>
                {requests.length} of the last {overview.data.keepPerTunnel} · kept {overview.data.retentionHours} h
              </Typography>
              <Button
                size='xs'
                variant='ghost'
                loading={clear.isPending}
                onClick={() => clear.mutate(undefined, { onSuccess: () => setSelected(null), onError: e => toast.danger((e as Error).message) })}
              >
                Clear
              </Button>
            </div>
            <div style={{ maxBlockSize: '70vh', overflowY: 'auto' }}>
              {list.isLoading ? (
                <Skeleton height='12rem' />
              ) : requests.length === 0 ? (
                <Typography variant='body2' style={{ ...muted, padding: 12 }}>No requests yet for this tunnel.</Typography>
              ) : (
                requests.map(r => <RequestRow key={r.id} r={r} active={r.id === selected} onClick={() => setSelected(r.id)} />)
              )}
            </div>
          </Card>
          <Card className='p-4' style={{ minInlineSize: 0 }}>
            {selected && label ? (
              <Detail accountId={accountId} label={label} id={selected} />
            ) : (
              <Typography variant='body2' style={muted}>Select a request to see its details.</Typography>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
