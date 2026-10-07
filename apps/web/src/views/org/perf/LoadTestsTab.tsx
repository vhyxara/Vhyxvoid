'use client'

// Load tests: pick one of your tunnels, mock APIs or verified domains, choose
// a preset or set users, duration, ramp-up, think time and pass/fail
// thresholds, then watch it live (requests per second and latency per
// second). Finished runs are kept; any two can be compared.

import { useEffect, useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ShareToChatButton } from '@/views/org/team/TeamParts'
import { Alert, Badge, Button, Card, Checkbox, Dialog, Progress, SelectField, Skeleton, TextareaField, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { LINE_COLORS, LineChart } from '@/components/charts/LineChart'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { loadTestsService, type LoadTestRun, type LoadTestsOverview } from '@/api/infrastructure/services/perf.service'
import { Stat } from './AnalyticsTab'
import { LOAD_PRESETS, STATUS_LABEL, STATUS_VARIANT, formatCount, formatDuration, formatMs, presetFor, relative, toStartBody, type LoadForm } from './perfForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const
const keys = { overview: (a: string) => ['load-tests', a] as const, one: (a: string, id: string) => ['load-tests', a, id] as const }

export default function LoadTestsTab({ accountId, initialRun }: { accountId: string; initialRun?: string | null }) {
  const ready = useBootstrapReady()
  const q = useQuery({ queryKey: keys.overview(accountId), queryFn: () => loadTestsService.overview(accountId), enabled: ready })
  const [selected, setSelected] = useState<string | null>(initialRun ?? null)
  const [compare, setCompare] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const o = q.data
  const running = o?.runs.find(r => r.status === 'RUNNING')

  useEffect(() => {
    if (!selected && o?.runs.length) setSelected(o.runs[0].id)
  }, [o, selected])

  if (q.error) return <Alert variant='danger'>{(q.error as Error).message}</Alert>
  if (!o) return <Skeleton height='24rem' />

  const off = !o.enabled || o.limits.maxVus === 0

  return (
    <div className='flex flex-col gap-4'>
      {!o.enabled && <Alert variant='info'>Load tests are switched off on this platform right now.</Alert>}
      {o.enabled && o.limits.maxVus === 0 && <Alert variant='info'>Load tests aren&apos;t included in your plan.</Alert>}
      {!off && <NewTest accountId={accountId} o={o} running={!!running} onStarted={id => setSelected(id)} />}
      {selected && <RunView accountId={accountId} id={selected} />}

      <Card className='p-4'>
        <div className='flex items-center justify-between gap-3 flex-wrap' style={{ marginBlockEnd: 8 }}>
          <Typography variant='subtitle1' style={{ fontWeight: 600 }}>
            Runs
          </Typography>
          <Button size='sm' variant='outline' icon={<i className='tabler-arrows-diff' />} disabled={compare.length !== 2} onClick={() => setShowCompare(true)} title='Tick two finished runs'>
            Compare {compare.length}/2
          </Button>
        </div>
        {o.runs.length === 0 ? (
          <Typography variant='body2' style={muted}>
            No load tests yet.
          </Typography>
        ) : (
          <ul className='flex flex-col' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {o.runs.map(r => (
              <li key={r.id} className='flex items-center gap-3 flex-wrap' style={{ padding: '8px 4px', borderBlockEnd: '1px solid var(--vhyx-color-border)', background: selected === r.id ? 'var(--vhyx-color-bg-muted)' : undefined, borderRadius: 6 }}>
                <Checkbox
                  checked={compare.includes(r.id)}
                  disabled={r.status === 'RUNNING' || !r.summary || (!compare.includes(r.id) && compare.length >= 2)}
                  onCheckedChange={v => setCompare(c => (v === true ? [...c, r.id] : c.filter(x => x !== r.id)))}
                  aria-label={`Compare ${r.name}`}
                />
                <button type='button' onClick={() => setSelected(r.id)} className='flex items-center gap-3 flex-wrap' style={{ flex: 1, minInlineSize: 0, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'start' }}>
                  <Badge size='sm' variant={STATUS_VARIANT[r.status]}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                  <span style={{ ...mono, ...muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxInlineSize: '22rem' }}>{r.target}</span>
                  {r.summary && (
                    <span style={{ fontSize: 12.5 }}>
                      {r.summary.rps}/s · p95 {formatMs(r.summary.latency.p95)} · {r.summary.errorRate}% errors
                    </span>
                  )}
                  <span style={{ ...muted, fontSize: 12, marginInlineStart: 'auto' }}>{relative(r.startedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {showCompare && compare.length === 2 && <CompareDialog accountId={accountId} a={compare[0]} b={compare[1]} onClose={() => setShowCompare(false)} />}
    </div>
  )
}

function NewTest({ accountId, o, running, onStarted }: { accountId: string; o: LoadTestsOverview; running: boolean; onStarted: (id: string) => void }) {
  const qc = useQueryClient()
  const first = presetFor('load', o.limits)
  const [f, setF] = useState<LoadForm>({
    name: 'Load test',
    target: o.targets[0]?.url ? `${o.targets[0].url}/` : '',
    method: 'GET',
    headers: '',
    body: '',
    vus: String(first.vus),
    durationSec: String(first.durationSec),
    rampUpSec: String(first.rampUpSec),
    thinkTimeMs: String(first.thinkTimeMs),
    maxRps: '',
    p95Ms: '500',
    errorRatePct: '1',
    count4xxAsErrors: true
  })
  const [advanced, setAdvanced] = useState(false)
  const set = (p: Partial<LoadForm>) => setF(cur => ({ ...cur, ...p }))
  const L = o.limits

  const start = useMutation({
    mutationFn: () => loadTestsService.start(accountId, toStartBody(f)),
    onSuccess: r => {
      toast.success('Load test started')
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
      onStarted(r.id)
    },
    onError: e => toast.danger((e as Error).message)
  })

  const vus = Number(f.vus)
  const dur = Number(f.durationSec)
  const problem = !f.target.trim() ? 'Pick a target' : !(vus >= 1 && vus <= L.maxVus) ? `1 to ${L.maxVus} users on your plan` : !(dur >= 5 && dur <= L.maxSeconds) ? `5 to ${L.maxSeconds} seconds on your plan` : Number(f.rampUpSec) > dur ? 'The ramp-up must fit in the duration' : null

  return (
    <Card className='p-4'>
      <form
        className='flex flex-col gap-4'
        onSubmit={e => {
          e.preventDefault()
          if (!problem) start.mutate()
        }}
      >
        <div className='flex items-baseline justify-between gap-3 flex-wrap'>
          <Typography variant='subtitle1' style={{ fontWeight: 600 }}>
            New load test
          </Typography>
          <Typography variant='caption' style={muted}>
            Plan: up to {L.maxVus} users, {formatDuration(L.maxSeconds)}, {L.maxRps} requests/s · {L.usedToday} of {L.perDay} today
          </Typography>
        </div>
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))', alignItems: 'end' }}>
          <TextField name='lt-name' label='Name' value={f.name} onChange={e => set({ name: e.target.value })} maxLength={80} />
          <SelectField name='lt-target-pick' label='Your targets' value='' placeholder={o.targets.length ? 'Pick a tunnel, mock or domain' : 'No tunnels, mocks or domains yet'} onValueChange={v => set({ target: `${v}/` })} options={o.targets.map(t => ({ value: t.url, label: `${t.kind === 'mock' ? 'Mock' : t.kind === 'domain' ? 'Domain' : 'Tunnel'}: ${t.name}` }))} />
        </div>
        <div className='flex flex-wrap gap-2 items-start'>
          <div style={{ inlineSize: '7.5rem' }}>
            <SelectField name='lt-method' label='Method' value={f.method} onValueChange={v => set({ method: v })} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(m => ({ value: m, label: m }))} />
          </div>
          <div style={{ flex: '1 1 18rem' }}>
            <TextField name='lt-target' label='URL' value={f.target} onChange={e => set({ target: e.target.value })} hint='A URL of one of your tunnels, mock APIs or verified custom domains, with its path.' style={mono} />
          </div>
        </div>
        <div className='flex flex-wrap gap-2' role='group' aria-label='Presets'>
          {LOAD_PRESETS.map(p => (
            <button
              key={p.key}
              type='button'
              title={p.help}
              onClick={() => {
                const v = presetFor(p.key, L)

                set({ vus: String(v.vus), durationSec: String(v.durationSec), rampUpSec: String(v.rampUpSec), thinkTimeMs: String(v.thinkTimeMs) })
              }}
              style={{ padding: '4px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: '1px solid var(--vhyx-color-border)', color: 'inherit', background: 'transparent' }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))' }}>
          <TextField name='lt-vus' type='number' label='Virtual users' min={1} max={L.maxVus} value={f.vus} onChange={e => set({ vus: e.target.value })} />
          <TextField name='lt-dur' type='number' label='Duration (s)' min={5} max={L.maxSeconds} value={f.durationSec} onChange={e => set({ durationSec: e.target.value })} />
          <TextField name='lt-ramp' type='number' label='Ramp-up (s)' min={0} value={f.rampUpSec} onChange={e => set({ rampUpSec: e.target.value })} />
          <TextField name='lt-think' type='number' label='Think time (ms)' min={0} max={60000} value={f.thinkTimeMs} onChange={e => set({ thinkTimeMs: e.target.value })} hint='Pause after each request' />
        </div>
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
          <TextField name='lt-p95' type='number' label='Pass if p95 below (ms)' min={1} value={f.p95Ms} onChange={e => set({ p95Ms: e.target.value })} />
          <TextField name='lt-err' type='number' label='Pass if errors at most (%)' min={0} max={100} value={f.errorRatePct} onChange={e => set({ errorRatePct: e.target.value })} />
        </div>
        <button type='button' onClick={() => setAdvanced(a => !a)} aria-expanded={advanced} style={{ alignSelf: 'start', background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'pointer', fontSize: 13 }}>
          {advanced ? 'Fewer options' : 'Headers, body, rate cap…'}
        </button>
        {advanced && (
          <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))' }}>
            <TextareaField name='lt-headers' label='Headers (one "Name: value" per line)' rows={4} value={f.headers} onChange={e => set({ headers: e.target.value })} style={mono} />
            <TextareaField name='lt-body' label='Body' rows={4} value={f.body} disabled={f.method === 'GET' || f.method === 'HEAD'} onChange={e => set({ body: e.target.value })} style={mono} />
            <TextField name='lt-rps' type='number' label={`Requests per second cap (empty = ${L.maxRps})`} min={0} max={L.maxRps} value={f.maxRps} onChange={e => set({ maxRps: e.target.value })} />
            <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
              <Checkbox checked={f.count4xxAsErrors} onCheckedChange={v => set({ count4xxAsErrors: v === true })} /> Count 4xx answers as errors
            </label>
          </div>
        )}
        <div className='flex items-center gap-3 flex-wrap'>
          <Button type='submit' icon={<i className='tabler-player-play' />} loading={start.isPending} disabled={!!problem || running} title={running ? 'A test is running' : (problem ?? undefined)}>
            Start
          </Button>
          <Typography variant='caption' style={muted}>
            {running ? 'A test is running in this workspace.' : problem ?? 'Requests go from VhyxVoid straight to your tunnel; they count toward your monthly usage and show in analytics.'}
          </Typography>
        </div>
      </form>
    </Card>
  )
}

function RunView({ accountId, id }: { accountId: string; id: string }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: keys.one(accountId, id),
    queryFn: () => loadTestsService.get(accountId, id),
    refetchInterval: d => (d.state.data?.status === 'RUNNING' ? 1000 : false)
  })
  const r = q.data
  const wasRunning = useMemo(() => ({ v: false }), [id])

  useEffect(() => {
    if (r?.status === 'RUNNING') wasRunning.v = true
    else if (r && wasRunning.v) {
      wasRunning.v = false
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
    }
  }, [r, wasRunning, qc, accountId])

  const cancel = useMutation({
    mutationFn: () => loadTestsService.cancel(accountId, id),
    onSuccess: () => toast.info('Stopping…'),
    onError: e => toast.danger((e as Error).message)
  })

  const remove = useMutation({
    mutationFn: () => loadTestsService.remove(accountId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
      toast.success('Deleted')
    },
    onError: e => toast.danger((e as Error).message)
  })

  if (q.isLoading) return <Skeleton height='16rem' />
  if (!r) return null

  return (
    <Card className='p-4' aria-live='polite'>
      <RunDetails accountId={accountId} r={r} onCancel={r.status === 'RUNNING' ? () => cancel.mutate() : undefined} cancelling={cancel.isPending || !!r.cancelRequested} onDelete={r.status !== 'RUNNING' ? () => remove.mutate() : undefined} />
    </Card>
  )
}

function RunDetails({ accountId, r, onCancel, cancelling, onDelete }: { accountId: string; r: LoadTestRun; onCancel?: () => void; cancelling?: boolean; onDelete?: () => void }) {
  const t = r.timeline ?? []
  const s = r.summary
  const elapsed = t.length
  const xLabels = t.map(p => `${p.t}s`)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-start justify-between gap-3 flex-wrap'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0 }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <Typography variant='h6' style={{ margin: 0 }}>
              {r.name}
            </Typography>
            <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </div>
          <span style={{ ...mono, ...muted, fontSize: 12, wordBreak: 'break-all' }}>
            {r.config.request.method} {r.target}
          </span>
          <span style={{ ...muted, fontSize: 12 }}>
            {r.config.vus} users · {formatDuration(r.config.durationSec)}
            {r.config.rampUpSec ? ` · ramp-up ${r.config.rampUpSec} s` : ''}
            {r.config.thinkTimeMs ? ` · think ${r.config.thinkTimeMs} ms` : ''} · ≤ {r.config.maxRps}/s · started {relative(r.startedAt)}
          </span>
        </div>
        <div className='flex gap-2'>
          {r.status !== 'RUNNING' && <ShareToChatButton accountId={accountId} path={`/organizations/${accountId}/performance?tab=load&run=${r.id}`} label='Share' />}
          {onCancel && (
            <Button size='sm' variant='destructive' onClick={onCancel} loading={cancelling}>
              Stop
            </Button>
          )}
          {onDelete && (
            <Button size='sm' variant='ghost' icon={<i className='tabler-trash' />} onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>
      {r.status === 'RUNNING' && <Progress value={Math.min(100, (elapsed / r.config.durationSec) * 100)} aria-label={`${elapsed} of ${r.config.durationSec} seconds`} />}
      {r.error && <Alert variant='warning'>{r.error}</Alert>}
      {s && (
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8rem), 1fr))' }}>
          <Stat label='Requests' value={formatCount(s.requests)} hint={`${s.rps}/s`} />
          <Stat label='Errors' value={`${s.errorRate}%`} hint={`${formatCount(s.errors)} requests`} tone={s.errorRate > 0 ? 'danger' : 'success'} />
          <Stat label='p50' value={formatMs(s.latency.p50)} hint={`avg ${formatMs(s.latency.avg)}`} />
          <Stat label='p95' value={formatMs(s.latency.p95)} />
          <Stat label='p99' value={formatMs(s.latency.p99)} hint={`max ${formatMs(s.latency.max)}`} />
        </div>
      )}
      {s && s.thresholds.length > 0 && (
        <ul className='flex flex-col gap-1' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {s.thresholds.map(th => (
            <li key={th.name} style={{ fontSize: 13.5 }}>
              <span aria-label={th.pass ? 'passed' : 'failed'} style={{ color: th.pass ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)', fontWeight: 700 }}>
                {th.pass ? '✓' : '✗'}
              </span>{' '}
              {th.name} {th.limit}: <strong>{th.actual}</strong>
            </li>
          ))}
        </ul>
      )}
      {t.length > 0 && (
        <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 26rem), 1fr))' }}>
          <section>
            <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
              Requests per second
            </Typography>
            <LineChart
              label='Requests and errors per second'
              xLabels={xLabels}
              height={200}
              series={[
                { key: 'rps', label: 'Requests', color: LINE_COLORS[0], values: t.map(p => p.requests) },
                { key: 'err', label: 'Errors', color: LINE_COLORS[1], values: t.map(p => p.errors) }
              ]}
            />
          </section>
          <section>
            <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
              Latency per second
            </Typography>
            <LineChart
              label='Latency percentiles per second'
              xLabels={xLabels}
              height={200}
              format={v => formatMs(v)}
              series={[
                { key: 'p50', label: 'p50', color: LINE_COLORS[0], values: t.map(p => (p.requests ? p.p50 : null)) },
                { key: 'p95', label: 'p95', color: LINE_COLORS[1], values: t.map(p => (p.requests ? p.p95 : null)) },
                { key: 'p99', label: 'p99', color: LINE_COLORS[2], values: t.map(p => (p.requests ? p.p99 : null)) }
              ]}
            />
          </section>
        </div>
      )}
      {s && (Object.keys(s.statuses).length > 0 || Object.keys(s.failures).length > 0) && (
        <div className='flex flex-wrap gap-2'>
          {Object.entries(s.statuses)
            .sort()
            .map(([code, n]) => (
              <Badge key={code} size='sm' variant={Number(code) >= 500 ? 'danger' : Number(code) >= 400 ? 'warning' : 'success'}>
                {`${code} × ${formatCount(n)}`}
              </Badge>
            ))}
          {Object.entries(s.failures).map(([why, n]) => (
            <Badge key={why} size='sm' variant='danger'>
              {`${why} × ${formatCount(n)}`}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function CompareDialog({ accountId, a, b, onClose }: { accountId: string; a: string; b: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['load-tests', accountId, 'compare', a, b], queryFn: () => loadTestsService.compare(accountId, a, b) })
  const d = q.data
  const len = Math.max(d?.a.timeline?.length ?? 0, d?.b.timeline?.length ?? 0)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(52rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Compare runs</Dialog.Title>
          {q.isLoading ? (
            <Skeleton height='16rem' />
          ) : q.error ? (
            <Alert variant='danger'>{(q.error as Error).message}</Alert>
          ) : d ? (
            <div className='flex flex-col gap-4 mbs-3'>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ ...muted, fontSize: 12, textAlign: 'end' }}>
                      <th style={{ textAlign: 'start', padding: 6 }}>Metric</th>
                      <th style={{ padding: 6 }}>A · {d.a.name}</th>
                      <th style={{ padding: 6 }}>B · {d.b.name}</th>
                      <th style={{ padding: 6 }}>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map(r => (
                      <tr key={r.metric} style={{ borderTop: '1px solid var(--vhyx-color-border)', textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                        <td style={{ textAlign: 'start', padding: 6 }}>{r.metric}</td>
                        <td style={{ padding: 6 }}>{r.a}</td>
                        <td style={{ padding: 6 }}>{r.b}</td>
                        <td style={{ padding: 6, color: r.better === null ? undefined : r.better ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)' }}>
                          {r.change === null ? '—' : `${r.change > 0 ? '+' : ''}${r.change}%`} {r.better === null ? '' : r.better ? '(better)' : '(worse)'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section>
                <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
                  p95 latency per second
                </Typography>
                <LineChart
                  label='p95 latency of both runs'
                  xLabels={Array.from({ length: len }, (_, i) => `${i + 1}s`)}
                  format={v => formatMs(v)}
                  series={[
                    { key: 'a', label: `A · ${d.a.name}`, color: LINE_COLORS[0], values: Array.from({ length: len }, (_, i) => d.a.timeline?.[i]?.p95 ?? null) },
                    { key: 'b', label: `B · ${d.b.name}`, color: LINE_COLORS[1], values: Array.from({ length: len }, (_, i) => d.b.timeline?.[i]?.p95 ?? null), dashed: true }
                  ]}
                />
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
