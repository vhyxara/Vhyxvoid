'use client'

// API analytics: per-endpoint volume, server errors and latency percentiles
// from the hub's 5-minute stats; new endpoints; the slowest and most failing;
// one endpoint over time; and spec drift against a mock API or OpenAPI.

import { useMemo, useRef, useState } from 'react'

import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, Input, SelectField, Skeleton, Textarea, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { LINE_COLORS, LineChart, Sparkline } from '@/components/charts/LineChart'
import { TrafficChart } from '@/components/charts/TrafficChart'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { analyticsService, type AnalyticsWindow, type DriftReport, type EndpointSummary } from '@/api/infrastructure/services/perf.service'
import { mocksService } from '@/api/infrastructure/services/mocks.service'
import { METHOD_VARIANT } from '../apiclient/apiClientForm'
import { formatCount, formatMs, shortTime, sortEndpoints, type EndpointSort } from './perfForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const
const WINDOWS: Array<{ value: AnalyticsWindow; label: string }> = [
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' }
]

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'success' }) {
  return (
    <div className='flex flex-col gap-1' style={{ padding: 14, borderRadius: 12, border: '1px solid var(--vhyx-color-border)', minInlineSize: 0 }}>
      <span style={{ ...muted, fontSize: 12 }}>{label}</span>
      <strong style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', color: tone ? `var(--vhyx-color-${tone})` : undefined }}>{value}</strong>
      {hint && <span style={{ ...muted, fontSize: 12 }}>{hint}</span>}
    </div>
  )
}

export default function AnalyticsTab({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const [window, setWindow] = useState<AnalyticsWindow>('24h')
  const [label, setLabel] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<EndpointSort>('requests')
  const [open, setOpen] = useState<EndpointSummary | null>(null)
  const [drift, setDrift] = useState(false)
  const q = useQuery({ queryKey: ['analytics', accountId, window, label], queryFn: () => analyticsService.overview(accountId, window, label || undefined), enabled: ready, refetchInterval: 60_000, placeholderData: p => p })
  const d = q.data
  const rows = useMemo(() => (d ? sortEndpoints(d.endpoints, sort, filter) : []), [d, sort, filter])

  if (q.error) return <Alert variant='danger'>{(q.error as Error).message}</Alert>

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div style={{ minInlineSize: '11rem' }}>
          <SelectField name='window' label='Period' value={window} onValueChange={v => setWindow(v as AnalyticsWindow)} options={WINDOWS} />
        </div>
        <div style={{ minInlineSize: '11rem' }}>
          <SelectField name='label' label='Tunnel or mock' value={label || '__all'} onValueChange={v => setLabel(v === '__all' ? '' : v)} options={[{ value: '__all', label: 'All' }, ...(d?.labels ?? []).map(l => ({ value: l, label: l }))]} />
        </div>
        <div style={{ flex: '1 1 12rem' }}>
          <Input aria-label='Filter endpoints' placeholder='Filter endpoints' value={filter} onChange={e => setFilter(e.target.value)} icon={<i className='tabler-search' />} />
        </div>
        <Button variant='outline' icon={<i className='tabler-git-compare' />} onClick={() => setDrift(true)} disabled={!d?.endpoints.length}>
          Compare with a spec
        </Button>
      </div>

      {!d ? (
        <Skeleton height='20rem' />
      ) : d.endpoints.length === 0 ? (
        <Card className='p-8'>
          <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
            <i className='tabler-chart-line' style={{ fontSize: 36, ...muted }} aria-hidden />
            <Typography variant='h6'>No traffic in this period</Typography>
            <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
              Requests to your tunnels, mock APIs and custom domains show up here per endpoint within a few minutes, with their error rate and how fast they answer.
            </Typography>
          </div>
        </Card>
      ) : (
        <>
          <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))', opacity: q.isFetching ? 0.7 : 1 }}>
            <Stat label='Requests' value={formatCount(d.totals.requests)} hint={`${d.totals.endpoints} endpoints`} />
            <Stat label='Server errors (5xx)' value={`${d.totals.errorRate}%`} hint={`4xx ${d.totals.clientErrorRate}%`} tone={d.totals.errorRate >= 5 ? 'danger' : undefined} />
            <Stat label='p50' value={formatMs(d.totals.p50)} hint={`average ${formatMs(d.totals.avgMs)}`} />
            <Stat label='p95' value={formatMs(d.totals.p95)} />
            <Stat label='p99' value={formatMs(d.totals.p99)} />
          </div>

          <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))' }}>
            <MiniList title='Slowest (p95)' empty='Needs at least 10 requests per endpoint.' items={d.slowest} value={e => formatMs(e.p95)} onOpen={setOpen} />
            <MiniList title='Most server errors' empty='No 5xx answers in this period.' items={d.failing} value={e => `${e.errorRate}%`} onOpen={setOpen} />
            <MiniList title='New endpoints' empty='No endpoint first seen in this period.' items={d.newEndpoints.slice(0, 5)} value={e => `first ${shortTime(e.firstSeen, true)}`} onOpen={setOpen} />
          </div>

          <Card className='p-0' style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <caption className='sr-only'>Endpoints</caption>
                <thead>
                  <tr style={{ ...muted, textAlign: 'end', fontSize: 12 }}>
                    <th style={{ textAlign: 'start', padding: '10px 12px' }}>
                      <SortButton by='route' sort={sort} setSort={setSort}>
                        Endpoint
                      </SortButton>
                    </th>
                    <th style={{ padding: '10px 8px' }}>
                      <SortButton by='requests' sort={sort} setSort={setSort}>
                        Requests
                      </SortButton>
                    </th>
                    <th style={{ padding: '10px 8px' }}>
                      <SortButton by='errorRate' sort={sort} setSort={setSort}>
                        5xx
                      </SortButton>
                    </th>
                    <th style={{ padding: '10px 8px' }}>p50</th>
                    <th style={{ padding: '10px 8px' }}>
                      <SortButton by='p95' sort={sort} setSort={setSort}>
                        p95
                      </SortButton>
                    </th>
                    <th style={{ padding: '10px 8px' }}>p99</th>
                    <th style={{ padding: '10px 12px', textAlign: 'start' }}>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(e => (
                    <tr key={`${e.label}${e.method}${e.route}`} style={{ borderTop: '1px solid var(--vhyx-color-border)', textAlign: 'end' }}>
                      <td style={{ textAlign: 'start', padding: '8px 12px', minInlineSize: '12rem' }}>
                        <button type='button' onClick={() => setOpen(e)} className='flex items-center gap-2' style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'start' }}>
                          <Badge size='sm' variant={METHOD_VARIANT[e.method] ?? 'default'} style={{ minInlineSize: 52, justifyContent: 'center' }}>
                            {e.method}
                          </Badge>
                          <span className='flex flex-col'>
                            <span style={mono}>{e.route}</span>
                            <span style={{ ...muted, fontSize: 11.5 }}>
                              {e.label}
                              {e.isNew && ' · new'}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums' }}>{formatCount(e.requests)}</td>
                      <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums', color: e.errorRate >= 5 ? 'var(--vhyx-color-danger)' : undefined }}>{e.errorRate}%</td>
                      <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums' }}>{formatMs(e.p50)}</td>
                      <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums' }}>{formatMs(e.p95)}</td>
                      <td style={{ padding: 8, fontVariantNumeric: 'tabular-nums' }}>{formatMs(e.p99)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <Sparkline values={e.trend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <Typography variant='body2' style={{ ...muted, padding: 16 }}>
                Nothing matches the filter.
              </Typography>
            )}
          </Card>
          <Typography variant='caption' style={muted}>
            Ids in paths are grouped (/users/42 → /users/:id). Percentiles are estimated from latency buckets; data is kept 7 days. Load-test traffic is included.
          </Typography>
        </>
      )}

      {open && <EndpointDialog accountId={accountId} window={window} e={open} onClose={() => setOpen(null)} />}
      {drift && <DriftDialog accountId={accountId} window={window} label={label} onClose={() => setDrift(false)} />}
    </div>
  )
}

function SortButton({ by, sort, setSort, children }: { by: EndpointSort; sort: EndpointSort; setSort: (s: EndpointSort) => void; children: React.ReactNode }) {
  return (
    <button type='button' onClick={() => setSort(by)} aria-pressed={sort === by} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: sort === by ? 'var(--vhyx-color-text)' : 'inherit', fontWeight: sort === by ? 700 : 500, fontSize: 12 }}>
      {children}
      {sort === by ? ' ↓' : ''}
    </button>
  )
}

function MiniList({ title, items, value, empty, onOpen }: { title: string; items: EndpointSummary[]; value: (e: EndpointSummary) => string; empty: string; onOpen: (e: EndpointSummary) => void }) {
  return (
    <Card className='p-4'>
      <Typography variant='subtitle2' style={{ marginBlockEnd: 8 }}>
        {title}
      </Typography>
      {items.length === 0 ? (
        <Typography variant='caption' style={muted}>
          {empty}
        </Typography>
      ) : (
        <ul className='flex flex-col gap-1' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map(e => (
            <li key={`${e.label}${e.method}${e.route}`}>
              <button type='button' onClick={() => onOpen(e)} className='flex items-center justify-between gap-2' style={{ inlineSize: '100%', background: 'none', border: 0, padding: '3px 0', color: 'inherit', cursor: 'pointer', textAlign: 'start' }}>
                <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ ...muted, fontSize: 11 }}>{e.method}</span> {e.route}
                </span>
                <strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value(e)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function EndpointDialog({ accountId, window, e, onClose }: { accountId: string; window: AnalyticsWindow; e: EndpointSummary; onClose: () => void }) {
  const q = useQuery({ queryKey: ['analytics', accountId, 'endpoint', window, e.label, e.method, e.route], queryFn: () => analyticsService.endpoint(accountId, { window, label: e.label, method: e.method, route: e.route }) })
  const d = q.data
  const xLabels = (d?.points ?? []).map(p => shortTime(p.t, window === '7d'))

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(56rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>
            <span style={mono}>
              {e.method} {e.route}
            </span>
          </Dialog.Title>
          <Typography variant='caption' style={muted}>
            {e.label} · e.g. {e.sample} · first seen {shortTime(e.firstSeen, true)}
          </Typography>
          {q.isLoading ? (
            <Skeleton height='20rem' />
          ) : q.error ? (
            <Alert variant='danger'>{(q.error as Error).message}</Alert>
          ) : d ? (
            <div className='flex flex-col gap-4 mbs-3'>
              <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))' }}>
                <Stat label='Requests' value={formatCount(d.summary.requests)} hint={`${d.summary.rpm}/min`} />
                <Stat label='2xx / 3xx' value={formatCount(d.summary.s2xx + d.summary.s3xx)} />
                <Stat label='4xx' value={formatCount(d.summary.s4xx)} />
                <Stat label='5xx' value={formatCount(d.summary.s5xx)} hint={`${d.summary.errorRate}%`} tone={d.summary.s5xx ? 'danger' : undefined} />
                <Stat label='Slowest' value={formatMs(d.summary.maxMs)} />
              </div>
              <section>
                <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
                  Latency
                </Typography>
                <LineChart
                  label={`Latency of ${e.method} ${e.route}`}
                  xLabels={xLabels}
                  format={v => formatMs(v)}
                  series={[
                    { key: 'p50', label: 'p50', color: LINE_COLORS[0], values: d.points.map(p => p.p50) },
                    { key: 'p95', label: 'p95', color: LINE_COLORS[1], values: d.points.map(p => p.p95) },
                    { key: 'p99', label: 'p99', color: LINE_COLORS[2], values: d.points.map(p => p.p99) }
                  ]}
                />
              </section>
              <section>
                <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
                  Requests per {d.stepMinutes >= 60 ? `${d.stepMinutes / 60} h` : `${d.stepMinutes} min`}
                </Typography>
                <TrafficChart series={d.points.map(p => ({ t: p.t, requests: p.requests, errors4xx: p.s4xx, errors5xx: p.s5xx, avgMs: p.avgMs }))} bucketMinutes={d.stepMinutes} label={`Requests to ${e.method} ${e.route}`} />
              </section>
            </div>
          ) : null}
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function DriftDialog({ accountId, window, label, onClose }: { accountId: string; window: AnalyticsWindow; label: string; onClose: () => void }) {
  const [source, setSource] = useState<'mock' | 'openapi'>('mock')
  const [mockId, setMockId] = useState('')
  const [doc, setDoc] = useState('')
  const [report, setReport] = useState<DriftReport | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mocks = useQuery({ queryKey: ['mocks', accountId], queryFn: () => mocksService.overview(accountId) })

  const run = useMutation({
    mutationFn: () => analyticsService.drift(accountId, { window, label: label || undefined, ...(source === 'mock' ? { mockId } : { document: doc }) }),
    onSuccess: setReport,
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(52rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Compare traffic with a spec</Dialog.Title>
          <Typography variant='body2' style={{ ...muted, marginBlockStart: 4 }}>
            Finds traffic your spec doesn&apos;t describe, operations nobody calls, and answers with status codes the spec doesn&apos;t list ({WINDOWS.find(w => w.value === window)?.label.toLowerCase()}
            {label ? `, ${label}` : ''}).
          </Typography>
          <div className='flex flex-col gap-3 mbs-3'>
            <SelectField name='source' label='Spec' value={source} onValueChange={v => setSource(v as 'mock' | 'openapi')} options={[{ value: 'mock', label: 'One of my mock APIs' }, { value: 'openapi', label: 'An OpenAPI document' }]} />
            {source === 'mock' ? (
              <SelectField name='mock' label='Mock API' value={mockId} onValueChange={setMockId} options={(mocks.data?.mocks ?? []).map(m => ({ value: m.id, label: m.name }))} placeholder={mocks.data?.mocks.length ? 'Pick one' : 'No mock APIs yet'} />
            ) : (
              <>
                <Textarea aria-label='OpenAPI document' rows={8} value={doc} onChange={e => setDoc(e.target.value)} placeholder='Paste OpenAPI 3 or Swagger 2 (JSON or YAML)' style={mono} />
                <div>
                  <input
                    ref={fileRef}
                    type='file'
                    accept='.json,.yaml,.yml'
                    hidden
                    onChange={async e => {
                      const f = e.target.files?.[0]

                      if (f) setDoc(await f.text())
                    }}
                  />
                  <Button size='sm' variant='outline' icon={<i className='tabler-upload' />} onClick={() => fileRef.current?.click()}>
                    Choose a file
                  </Button>
                </div>
              </>
            )}
            <div>
              <Button onClick={() => run.mutate()} loading={run.isPending} disabled={source === 'mock' ? !mockId : doc.trim().length < 2}>
                Compare
              </Button>
            </div>
            {report && (
              <div className='flex flex-col gap-3'>
                <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))' }}>
                  <Stat label='Spec coverage' value={`${report.coverage}%`} hint={`of ${report.spec.operations} operations called`} />
                  <Stat label='Undocumented' value={String(report.undocumented.length)} hint='endpoints in traffic' tone={report.undocumented.length ? 'danger' : 'success'} />
                  <Stat label='Unexpected statuses' value={String(report.unexpectedStatuses.length)} tone={report.unexpectedStatuses.length ? 'danger' : 'success'} />
                  <Stat label='Unused' value={String(report.unused.length)} hint='operations with no traffic' />
                </div>
                <DriftList title='Traffic the spec doesn’t describe' empty='Every endpoint in the traffic is in the spec.' items={report.undocumented.map(u => ({ key: `${u.method}${u.route}`, left: `${u.method} ${u.route}`, right: `${formatCount(u.requests)} requests` }))} />
                <DriftList title='Status codes the spec doesn’t list' empty='Every answer’s status class is documented.' items={report.unexpectedStatuses.map(u => ({ key: `${u.method}${u.route}${u.statusClass}`, left: `${u.method} ${u.route} → ${u.statusClass}`, right: `${formatCount(u.requests)} (spec: ${u.path})` }))} />
                <DriftList title='Operations nobody called' empty='Every operation was called.' items={report.unused.map(u => ({ key: `${u.method}${u.path}`, left: `${u.method} ${u.path}`, right: '' }))} />
              </div>
            )}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function DriftList({ title, items, empty }: { title: string; items: Array<{ key: string; left: string; right: string }>; empty: string }) {
  return (
    <section>
      <Typography variant='subtitle2' style={{ marginBlockEnd: 4 }}>
        {title} {items.length ? `(${items.length})` : ''}
      </Typography>
      {items.length === 0 ? (
        <Typography variant='caption' style={muted}>
          ✓ {empty}
        </Typography>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxBlockSize: 220, overflowY: 'auto' }}>
          {items.map(i => (
            <li key={i.key} className='flex justify-between gap-3' style={{ padding: '4px 0', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
              <span style={mono}>{i.left}</span>
              <span style={{ ...muted, fontSize: 12.5 }}>{i.right}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
