'use client'

// Monitors: run an API client collection every 1–60 minutes from VhyxVoid,
// with uptime and latency history; a MONITOR alert rule notifies when one
// fails a number of checks in a row.

import { useEffect, useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, Switch, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { LINE_COLORS, LineChart } from '@/components/charts/LineChart'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { monitorsService, type Monitor, type MonitorInput, type MonitorsOverview, type UptimeBar } from '@/api/infrastructure/services/perf.service'
import { RunReportView } from '../apiclient/ApiClientParts'
import { Stat } from './AnalyticsTab'
import { STATUS_LABEL, STATUS_VARIANT, formatMs, relative, shortTime, uptimeColor } from './perfForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const keys = { overview: (a: string) => ['monitors', a] as const, one: (a: string, id: string, w: string) => ['monitors', a, id, w] as const }

export default function MonitorsTab({ accountId, initialMonitor }: { accountId: string; initialMonitor?: string | null }) {
  const ready = useBootstrapReady()
  const q = useQuery({ queryKey: keys.overview(accountId), queryFn: () => monitorsService.overview(accountId), enabled: ready, refetchInterval: 30_000 })
  const [editing, setEditing] = useState<Monitor | 'new' | null>(null)
  const [selected, setSelected] = useState<string | null>(initialMonitor ?? null)
  const o = q.data

  useEffect(() => {
    if (!selected && o?.monitors.length) setSelected(o.monitors[0].id)
  }, [o, selected])

  if (q.error) return <Alert variant='danger'>{(q.error as Error).message}</Alert>
  if (!o) return <Skeleton height='20rem' />

  const atLimit = o.monitors.length >= o.limits.max

  return (
    <div className='flex flex-col gap-4'>
      {!o.enabled && <Alert variant='info'>Monitors are paused on this platform right now.</Alert>}
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <Typography variant='body2' style={muted}>
          {o.monitors.length} of {o.limits.max} monitors · every {o.limits.minInterval} min at most on your plan ·{' '}
          <Link href={`/organizations/${accountId}/alerts`}>get alerted when one fails</Link>
        </Typography>
        {o.canManage && (
          <Button icon={<i className='tabler-plus' />} onClick={() => setEditing('new')} disabled={atLimit || !o.collections.length || !o.enabled} title={!o.collections.length ? 'Create an API client collection first' : atLimit ? 'Your plan’s limit is reached' : undefined}>
            New monitor
          </Button>
        )}
      </div>
      {!o.collections.length && (
        <Alert variant='info'>
          A monitor runs one of your <Link href={`/organizations/${accountId}/api-client`}>API client collections</Link> with its checks. Create a collection first.
        </Alert>
      )}
      {o.monitors.length === 0 ? (
        <Card className='p-8'>
          <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
            <i className='tabler-heartbeat' style={{ fontSize: 36, ...muted }} aria-hidden />
            <Typography variant='h6'>No monitors yet</Typography>
            <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
              Pick a collection and how often to run it. You get uptime, response times and, with an alert rule, an email or Slack message when checks start failing.
            </Typography>
          </div>
        </Card>
      ) : (
        <div className='flex flex-col gap-2'>
          {o.monitors.map(m => (
            <MonitorRow key={m.id} accountId={accountId} m={m} canManage={o.canManage} selected={selected === m.id} onSelect={() => setSelected(m.id)} onEdit={() => setEditing(m)} />
          ))}
        </div>
      )}
      {selected && o.monitors.some(m => m.id === selected) && <MonitorDetailView accountId={accountId} id={selected} />}
      {editing && <MonitorDialog accountId={accountId} o={o} m={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={id => setSelected(id)} />}
    </div>
  )
}

function MonitorRow({ accountId, m, canManage, selected, onSelect, onEdit }: { accountId: string; m: Monitor; canManage: boolean; selected: boolean; onSelect: () => void; onEdit: () => void }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['monitors', accountId] })
  const run = useMutation({
    mutationFn: () => monitorsService.run(accountId, m.id),
    onSuccess: r => {
      if (r.ok) toast.success(`${m.name}: all ${r.report.total} requests passed`)
      else toast.danger(`${m.name}: ${r.report.failed + r.report.errored} of ${r.report.total} failed`)
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const toggle = useMutation({ mutationFn: (enabled: boolean) => monitorsService.save(accountId, m.id, { enabled }), onSuccess: refresh, onError: e => toast.danger((e as Error).message) })
  const remove = useMutation({ mutationFn: () => monitorsService.remove(accountId, m.id), onSuccess: () => (toast.success('Monitor deleted'), refresh()), onError: e => toast.danger((e as Error).message) })
  const status = m.enabled ? m.status : null

  return (
    <Card className='p-3' style={{ outline: selected ? '2px solid var(--vhyx-color-accent)' : undefined, outlineOffset: -1 }}>
      <div className='flex items-center gap-3 flex-wrap'>
        <button type='button' onClick={onSelect} className='flex items-center gap-3 flex-wrap' style={{ flex: '1 1 20rem', minInlineSize: 0, background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'start' }} aria-pressed={selected}>
          {status ? (
            <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
          ) : (
            <Badge variant='default'>paused</Badge>
          )}
          <span className='flex flex-col' style={{ minInlineSize: 0 }}>
            <strong>{m.name}</strong>
            <span style={{ ...muted, fontSize: 12.5 }}>
              {m.collectionName} · every {m.intervalMinutes} min · last {relative(m.lastRunAt)}
              {m.lastDurationMs !== null ? ` in ${formatMs(m.lastDurationMs)}` : ''}
            </span>
            {m.lastError && m.status === 'DOWN' && <span style={{ fontSize: 12.5, color: 'var(--vhyx-color-danger)' }}>{m.lastError}</span>}
          </span>
          <span style={{ marginInlineStart: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
            <span style={muted}>24 h </span>
            <strong>{m.uptime24h === null ? '—' : `${m.uptime24h}%`}</strong>
          </span>
        </button>
        {canManage && (
          <div className='flex items-center gap-2'>
            <Switch checked={m.enabled} disabled={toggle.isPending} onCheckedChange={(v: boolean) => toggle.mutate(v)} aria-label={`${m.name} on`} />
            <Button size='sm' variant='outline' icon={<i className='tabler-player-play' />} loading={run.isPending} onClick={() => run.mutate()}>
              Run now
            </Button>
            <Button size='sm' variant='ghost' onClick={onEdit}>
              Edit
            </Button>
            <Button size='sm' variant='ghost' icon={<i className='tabler-trash' />} aria-label={`Delete ${m.name}`} onClick={() => remove.mutate()} loading={remove.isPending} />
          </div>
        )}
      </div>
    </Card>
  )
}

function UptimeStrip({ bars, label }: { bars: UptimeBar[]; label: string }) {
  const [active, setActive] = useState<number | null>(null)
  const b = active !== null ? bars[active] : null

  return (
    <div className='flex flex-col gap-1'>
      <div role='list' aria-label={label} className='flex gap-[2px]' style={{ blockSize: 32 }} onPointerLeave={() => setActive(null)}>
        {bars.map((x, i) => (
          <div
            key={x.from}
            role='listitem'
            tabIndex={0}
            aria-label={`${shortTime(x.from, true)}: ${x.checks ? `${x.uptime}% of ${x.checks} checks passed` : 'no checks'}`}
            onPointerEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            style={{ flex: 1, borderRadius: 3, background: uptimeColor(x.uptime), opacity: active === null || active === i ? 1 : 0.6, outlineOffset: 1 }}
          />
        ))}
      </div>
      <span style={{ ...muted, fontSize: 12, minBlockSize: 18 }} role='status'>
        {b ? `${shortTime(b.from, true)} · ${b.checks ? `${b.ok}/${b.checks} passed (${b.uptime}%)${b.avgMs !== null ? ` · ${formatMs(b.avgMs)}` : ''}` : 'no checks'}` : 'Green: all passed · amber: ≥ 95 % · red: below · grey: no checks'}
      </span>
    </div>
  )
}

function MonitorDetailView({ accountId, id }: { accountId: string; id: string }) {
  const [window, setWindow] = useState<'24h' | '7d' | '30d'>('24h')
  const [report, setReport] = useState<string | null>(null)
  const q = useQuery({ queryKey: keys.one(accountId, id, window), queryFn: () => monitorsService.detail(accountId, id, window), refetchInterval: 30_000, placeholderData: p => p })
  const d = q.data

  if (!d) return <Skeleton height='16rem' />

  return (
    <Card className='p-4'>
      <div className='flex flex-col gap-4'>
        <div className='flex items-center justify-between gap-3 flex-wrap'>
          <Typography variant='h6' style={{ margin: 0 }}>
            {d.monitor.name}
          </Typography>
          <div style={{ minInlineSize: '10rem' }}>
            <SelectField name='mon-window' size='sm' value={window} onValueChange={v => setWindow(v as '24h')} options={[{ value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} />
          </div>
        </div>
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))' }}>
          <Stat label='Uptime' value={d.uptime.uptime === null ? '—' : `${d.uptime.uptime}%`} hint={`${d.uptime.ok} of ${d.uptime.checks} checks passed`} tone={d.uptime.uptime !== null && d.uptime.uptime < 99 ? 'danger' : undefined} />
          <Stat label='Average run' value={formatMs(d.uptime.avgMs)} />
          <Stat label='Failing in a row' value={String(d.monitor.consecutiveFailures)} tone={d.monitor.consecutiveFailures ? 'danger' : undefined} />
          <Stat label='Next check' value={d.monitor.enabled ? relative(d.monitor.nextRunAt) : 'paused'} />
        </div>
        <UptimeStrip bars={d.uptime.bars} label={`Uptime of ${d.monitor.name}`} />
        {d.checks.length > 0 && (
          <section>
            <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
              Run time per check
            </Typography>
            <LineChart
              label={`Run time of ${d.monitor.name} per check`}
              xLabels={d.checks.map(c => shortTime(c.at, window !== '24h'))}
              format={v => formatMs(v)}
              height={180}
              series={[{ key: 'ms', label: 'Run time', color: LINE_COLORS[0], values: d.checks.map(c => c.durationMs) }]}
              markers={d.checks.flatMap((c, i) => (c.ok ? [] : [{ index: i, color: 'var(--vhyx-color-danger)', title: `Failed: ${c.passed}/${c.total} passed` }]))}
            />
          </section>
        )}
        <section>
          <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
            Recent checks
          </Typography>
          {d.recent.length === 0 ? (
            <Typography variant='caption' style={muted}>
              No checks yet; the first runs within a minute.
            </Typography>
          ) : (
            <ul className='flex flex-col' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.recent.map(c => (
                <li key={c.id} className='flex items-center gap-3 flex-wrap' style={{ padding: '6px 0', borderBlockEnd: '1px solid var(--vhyx-color-border)', fontSize: 13 }}>
                  <span aria-label={c.ok ? 'passed' : 'failed'} style={{ color: c.ok ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)', fontWeight: 700 }}>
                    {c.ok ? '✓' : '✗'}
                  </span>
                  <span>{shortTime(c.at, true)}</span>
                  <span style={muted}>
                    {c.passed}/{c.total} passed · {formatMs(c.durationMs)}
                  </span>
                  {!c.ok && (
                    <Button size='sm' variant='ghost' onClick={() => setReport(c.id)} style={{ marginInlineStart: 'auto' }}>
                      What failed
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {report && <CheckDialog accountId={accountId} monitorId={id} resultId={report} onClose={() => setReport(null)} />}
    </Card>
  )
}

function CheckDialog({ accountId, monitorId, resultId, onClose }: { accountId: string; monitorId: string; resultId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['monitors', accountId, monitorId, 'result', resultId], queryFn: () => monitorsService.result(accountId, monitorId, resultId) })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(52rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Failed check{q.data ? ` · ${shortTime(q.data.at, true)}` : ''}</Dialog.Title>
          <div className='mbs-3'>{q.isLoading ? <Skeleton height='12rem' /> : q.data?.report ? <RunReportView report={q.data.report} /> : <Alert variant='info'>No report was kept for this check.</Alert>}</div>
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

function MonitorDialog({ accountId, o, m, onClose, onSaved }: { accountId: string; o: MonitorsOverview; m: Monitor | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<MonitorInput>(() => ({
    name: m?.name ?? 'API health',
    collectionId: m?.collectionId ?? o.collections[0]?.id ?? '',
    environmentId: m?.environmentId ?? null,
    folderId: m?.folderId ?? null,
    intervalMinutes: m?.intervalMinutes ?? Math.max(5, o.limits.minInterval),
    enabled: m?.enabled ?? true
  }))
  const set = (p: Partial<MonitorInput>) => setF(cur => ({ ...cur, ...p }))
  const folders = o.collections.find(c => c.id === f.collectionId)?.folders ?? []
  const intervals = o.limits.intervals.includes(f.intervalMinutes) ? o.limits.intervals : [...o.limits.intervals, f.intervalMinutes].sort((a, b) => a - b)

  const save = useMutation({
    mutationFn: () => (m ? monitorsService.save(accountId, m.id, f) : monitorsService.create(accountId, f)),
    onSuccess: r => {
      toast.success(m ? 'Monitor saved' : 'Monitor created; the first check runs within a minute')
      qc.invalidateQueries({ queryKey: ['monitors', accountId] })
      onSaved(r.id)
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(36rem, calc(100vw - 32px))' }}>
          <Dialog.Title>{m ? 'Edit monitor' : 'New monitor'}</Dialog.Title>
          <form
            className='flex flex-col gap-3 mbs-3'
            onSubmit={e => {
              e.preventDefault()
              if (f.name.trim() && f.collectionId) save.mutate()
            }}
          >
            <TextField name='mon-name' label='Name' value={f.name} onChange={e => set({ name: e.target.value })} maxLength={80} />
            <SelectField name='mon-col' label='Collection' value={f.collectionId} onValueChange={v => set({ collectionId: v, folderId: null })} options={o.collections.map(c => ({ value: c.id, label: c.name }))} />
            <SelectField name='mon-folder' label='Requests' value={f.folderId ?? ''} onValueChange={v => set({ folderId: v || null })} options={[{ value: '', label: 'Whole collection' }, ...folders.map(x => ({ value: x.id, label: `Folder: ${x.name}` }))]} />
            <SelectField name='mon-env' label='Environment' value={f.environmentId ?? ''} onValueChange={v => set({ environmentId: v || null })} options={[{ value: '', label: 'None' }, ...o.environments.map(e => ({ value: e.id, label: e.name }))]} />
            <SelectField name='mon-int' label='Run every' value={String(f.intervalMinutes)} onValueChange={v => set({ intervalMinutes: Number(v) })} options={intervals.map(i => ({ value: String(i), label: i === 60 ? 'hour' : `${i} minute${i === 1 ? '' : 's'}` }))} />
            <Typography variant='caption' style={muted}>
              A check passes when every request answers and every check of the collection passes. Requests go from VhyxVoid, so they reach public addresses only (use a tunnel for a local server).
            </Typography>
            <Dialog.Footer>
              <Button type='button' variant='secondary' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={save.isPending} disabled={!f.name.trim() || !f.collectionId}>
                {m ? 'Save' : 'Create'}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
