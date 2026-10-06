'use client'

// Mock API editor parts for phase 2: resources (seed + live data), export to
// every format, record endpoints from captured traffic, and the inspector's
// "Add to a mock API".

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Checkbox, Dialog, SelectField, Skeleton, Switch, Textarea, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { inspectorService } from '@/api/infrastructure/services/inspector.service'
import { mocksService, type MockApi, type MockExportFormat, type MockImportResult, type MockResource } from '@/api/infrastructure/services/mocks.service'
import { EXPORT_FORMATS, METHOD_VARIANT, RESOURCE_PATH_RE, parseSeed, resourceRoutes } from './mockForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function reportImport(r: MockImportResult, verb: string) {
  const extra = [r.addedResources ? `${r.addedResources} resource${r.addedResources === 1 ? '' : 's'}` : '', r.skipped ? `${r.skipped} already there` : ''].filter(Boolean).join(', ')

  toast.success(`${verb} ${r.added} endpoint${r.added === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`)
  for (const w of r.warnings.slice(0, 3)) toast.info(w)
}

// ── Resource editor ───────────────────────────────────────────────────────────

export function ResourceEditor(props: {
  accountId: string
  mockId: string
  r: MockResource
  /** Saved on the server (data can be shown and reset). */
  saved: MockResource | undefined
  baseUrl: string | null
  canEdit: boolean
  onChange: (patch: Partial<MockResource>) => void
  onDelete: () => void
}) {
  const { r, canEdit, onChange } = props
  const [seedText, setSeedText] = useState(() => JSON.stringify(r.seed, null, 2))
  const parsed = parseSeed(seedText)
  const pathOk = RESOURCE_PATH_RE.test(r.path)
  const seedChanged = !!props.saved && JSON.stringify(props.saved.seed) !== JSON.stringify(r.seed)

  return (
    <Card className='p-4'>
      <div className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <i className='tabler-database' aria-hidden style={{ fontSize: 18, color: 'var(--vhyx-color-accent)' }} />
            <Typography variant='h6' style={{ margin: 0 }}>
              Resource
            </Typography>
          </div>
          <div className='flex items-center gap-3'>
            <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
              <Switch checked={r.enabled} disabled={!canEdit} onCheckedChange={(v: boolean) => onChange({ enabled: v })} aria-label='Resource enabled' /> Enabled
            </label>
            {canEdit && (
              <Button size='sm' variant='ghost' onClick={props.onDelete}>
                Delete
              </Button>
            )}
          </div>
        </div>
        <Typography variant='body2' style={muted}>
          A working REST collection with no code: create, read, update and delete items through the mock’s URL. Data starts from the seed below and is kept between requests; endpoints you add with the same paths answer first.
        </Typography>

        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))', alignItems: 'start' }}>
          <TextField
            name='resName'
            label='Name'
            value={r.name}
            disabled={!canEdit}
            onChange={e => {
              const name = e.target.value
              const followPath = r.path === `/${r.name}`

              onChange({ name, ...(followPath ? { path: `/${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}` } : {}) })
            }}
          />
          <TextField name='resPath' label='Path' value={r.path} disabled={!canEdit} onChange={e => onChange({ path: e.target.value })} error={pathOk ? undefined : 'Like /users or /api/v1/orders, no parameters'} style={mono} />
          <TextField name='resId' label='Id field' value={r.idField ?? 'id'} disabled={!canEdit} onChange={e => onChange({ idField: e.target.value || 'id' })} style={mono} />
        </div>

        <div className='flex flex-col gap-1'>
          <Typography variant='body2' style={{ fontWeight: 600 }}>
            Routes
          </Typography>
          {resourceRoutes(r).map(x => (
            <div key={`${x.method} ${x.path}`} className='flex items-center gap-2' style={{ fontSize: 13 }}>
              <Badge size='sm' variant={METHOD_VARIANT[x.method as keyof typeof METHOD_VARIANT] ?? 'default'} style={{ minInlineSize: 56, justifyContent: 'center' }}>
                {x.method}
              </Badge>
              <span style={mono}>{x.path}</span>
              <span style={muted}>{x.does}</span>
            </div>
          ))}
        </div>

        <div className='flex flex-col gap-2'>
          <Typography variant='body2' style={{ fontWeight: 600 }}>
            Seed data
          </Typography>
          <Textarea
            name='seed'
            aria-label='Seed data'
            rows={10}
            value={seedText}
            disabled={!canEdit}
            spellCheck={false}
            style={{ ...mono, lineHeight: 1.5 }}
            onChange={e => {
              setSeedText(e.target.value)
              const p = parseSeed(e.target.value)

              if ('seed' in p) onChange({ seed: p.seed })
            }}
          />
          {'error' in parsed ? (
            <Typography variant='caption' style={{ color: 'var(--vhyx-color-warning)' }}>
              {parsed.error} (the last valid version is kept)
            </Typography>
          ) : (
            <Typography variant='caption' style={muted}>
              {parsed.seed.length} item{parsed.seed.length === 1 ? '' : 's'}. {seedChanged ? 'After saving, use Reset below to load the new seed into the live data.' : 'Reset puts the live data back to this.'}
            </Typography>
          )}
        </div>

        {props.saved ? (
          <LiveData accountId={props.accountId} mockId={props.mockId} resource={props.saved} canEdit={canEdit} />
        ) : (
          <Alert variant='info'>Save the mock to start serving this resource and see its live data.</Alert>
        )}
      </div>
    </Card>
  )
}

function LiveData({ accountId, mockId, resource, canEdit }: { accountId: string; mockId: string; resource: MockResource; canEdit: boolean }) {
  const qc = useQueryClient()
  const key = ['mock-data', accountId, mockId, resource.id] as const
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: key, queryFn: () => mocksService.data(accountId, mockId, resource.id) })
  const reset = useMutation({
    mutationFn: () => mocksService.resetData(accountId, mockId, resource.id),
    onSuccess: () => {
      toast.success(`${resource.name} reset to its seed`)
      qc.invalidateQueries({ queryKey: key })
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <div className='flex flex-col gap-2' style={{ borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 12 }}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Typography variant='body2' style={{ fontWeight: 600 }}>
          Live data {data ? <span style={muted}>· {data.count} item{data.count === 1 ? '' : 's'}</span> : null}
        </Typography>
        <div className='flex gap-2'>
          <Button size='xs' variant='ghost' icon={<i className='tabler-refresh' />} loading={isFetching} onClick={() => refetch()}>
            Refresh
          </Button>
          {canEdit && (
            <Button size='xs' variant='outline' loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset to seed
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <Skeleton height='6rem' />
      ) : error ? (
        <Alert variant='warning'>{(error as Error).message}</Alert>
      ) : (
        <pre style={{ ...mono, margin: 0, padding: 10, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', whiteSpace: 'pre-wrap', maxBlockSize: 280, overflow: 'auto' }}>
          {JSON.stringify(data?.items ?? [], null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export function ExportDialog({ accountId, mockId, dirty, onClose }: { accountId: string; mockId: string; dirty: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function run(format: MockExportFormat) {
    setBusy(format)

    try {
      const { blob, name } = await mocksService.exportFile(accountId, mockId, format)

      download(blob, name)
    } catch (e) {
      toast.danger((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Export</Dialog.Title>
          {dirty && <Alert variant='info'>Exports contain the saved version. Save first to include your changes.</Alert>}
          <div className='flex flex-col gap-2' style={{ marginBlockStart: 8 }}>
            {EXPORT_FORMATS.map(f => (
              <div key={f.value} className='flex items-center justify-between gap-3' style={{ padding: '8px 0', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
                <div className='flex flex-col'>
                  <span style={{ fontWeight: 600 }}>{f.label}</span>
                  <span style={{ ...muted, fontSize: 13 }}>{f.help}</span>
                </div>
                <Button size='sm' variant='outline' icon={<i className='tabler-download' />} loading={busy === f.value} onClick={() => run(f.value)}>
                  Download
                </Button>
              </div>
            ))}
          </div>
          <Typography variant='caption' style={{ ...muted, display: 'block', marginBlockStart: 8 }}>
            Run any JSON export on your machine, offline: <span style={mono}>npx @vhyxvoid/agent mock ./file.json</span>
          </Typography>
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Record from captured traffic ──────────────────────────────────────────────

export function RecordDialog({ accountId, mockId, defaultLabel, onClose, onDone }: { accountId: string; mockId: string; defaultLabel: string; onClose: () => void; onDone: (m: MockApi) => void }) {
  const overview = useQuery({ queryKey: ['inspector', accountId], queryFn: () => inspectorService.overview(accountId) })
  const labels = useMemo(() => (overview.data?.tunnels ?? []).map(t => t.label), [overview.data])
  const [label, setLabel] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!label && labels.length) setLabel(labels.find(l => l !== defaultLabel) ?? labels[0])
  }, [label, labels, defaultLabel])

  const list = useQuery({ queryKey: ['inspector', accountId, label, 'record'], queryFn: () => inspectorService.list(accountId, label, 200), enabled: !!label })
  // Mock answers are not real traffic; recording them again would be circular.
  const rows = (list.data?.requests ?? []).filter(x => x.status !== null && !x.mock && !x.answeredByRule)

  useEffect(() => setPicked(new Set()), [label])

  const run = useMutation({
    mutationFn: () => mocksService.record(accountId, mockId, label, [...picked]),
    onSuccess: r => {
      reportImport(r, 'Recorded')
      onDone(r.mock)
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  const all = rows.length > 0 && rows.every(x => picked.has(x.id))

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='lg'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Record endpoints from real traffic</Dialog.Title>
          <Typography variant='body2' style={muted}>
            Pick requests the request inspector captured on a tunnel. Each method and path becomes an endpoint with the real response; ids in paths (numbers, UUIDs) become parameters, and other statuses become extra responses with a rule. Routes the mock already has are skipped.
          </Typography>
          {overview.isLoading ? (
            <Skeleton height='8rem' />
          ) : labels.length === 0 ? (
            <Alert variant='info' style={{ marginBlockStart: 12 }}>
              Nothing captured in the last 24 hours. Send some requests through a tunnel with the <Link href={`/organizations/${accountId}/inspector`}>request inspector</Link> on, then come back.
            </Alert>
          ) : (
            <div className='flex flex-col gap-3' style={{ marginBlockStart: 12 }}>
              <div style={{ maxInlineSize: 280 }}>
                <SelectField name='recordLabel' label='Tunnel' value={label} onValueChange={setLabel} options={labels.map(l => ({ value: l, label: l }))} />
              </div>
              <div className='flex items-center justify-between'>
                <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
                  <Checkbox checked={all} onCheckedChange={v => setPicked(v === true ? new Set(rows.map(x => x.id)) : new Set())} aria-label='Select all' /> Select all ({rows.length})
                </label>
                <Typography variant='caption' style={muted}>
                  {picked.size} selected
                </Typography>
              </div>
              <div className='flex flex-col' style={{ maxBlockSize: '45vh', overflowY: 'auto', border: '1px solid var(--vhyx-color-border)', borderRadius: 10 }}>
                {list.isLoading ? (
                  <Skeleton height='8rem' />
                ) : rows.length === 0 ? (
                  <Typography variant='body2' style={{ ...muted, padding: 12 }}>
                    No captured requests on this tunnel.
                  </Typography>
                ) : (
                  rows.map(x => (
                    <label key={x.id} className='flex items-center gap-2' style={{ padding: '6px 10px', borderBlockEnd: '1px solid var(--vhyx-color-border)', cursor: 'pointer' }}>
                      <Checkbox
                        checked={picked.has(x.id)}
                        onCheckedChange={v => {
                          const next = new Set(picked)

                          if (v === true) next.add(x.id)
                          else next.delete(x.id)
                          setPicked(next)
                        }}
                        aria-label={`${x.method} ${x.path}`}
                      />
                      <span style={{ ...mono, fontWeight: 600, minInlineSize: 56 }}>{x.method}</span>
                      <span style={{ ...mono, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.path}</span>
                      <Badge size='sm' variant={(x.status ?? 0) >= 500 ? 'danger' : (x.status ?? 0) >= 400 ? 'warning' : 'success'}>
                        {x.status}
                      </Badge>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={picked.size === 0}>
              Record {picked.size || ''}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Inspector: add one captured request to a mock ─────────────────────────────

export function AddToMockDialog({ accountId, label, requestId, title, onClose }: { accountId: string; label: string; requestId: string; title: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: o, isLoading } = useQuery({ queryKey: ['mocks', accountId], queryFn: () => mocksService.overview(accountId) })
  const [target, setTarget] = useState('')

  useEffect(() => {
    if (!target && o?.mocks.length) setTarget(o.mocks[0].id)
  }, [o, target])

  const run = useMutation({
    mutationFn: () => mocksService.record(accountId, target, label, [requestId]),
    onSuccess: r => {
      reportImport(r, 'Added')
      qc.invalidateQueries({ queryKey: ['mocks', accountId] })
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Add to a mock API</Dialog.Title>
          <Typography variant='body2' style={muted}>
            <span style={mono}>{title}</span> becomes an endpoint with this response. An id in the path becomes a parameter.
          </Typography>
          {isLoading ? (
            <Skeleton height='3rem' />
          ) : !o?.mocks.length ? (
            <Alert variant='info' style={{ marginBlockStart: 12 }}>
              No mock APIs yet. <Link href={`/organizations/${accountId}/mocks`}>Create one</Link>, then add requests to it.
            </Alert>
          ) : !o.canManage ? (
            <Alert variant='info' style={{ marginBlockStart: 12 }}>
              Only owners and admins can change mock APIs.
            </Alert>
          ) : (
            <div style={{ marginBlockStart: 12 }}>
              <SelectField name='targetMock' label='Mock API' value={target} onValueChange={setTarget} options={o.mocks.map(m => ({ value: m.id, label: `${m.name} (${m.label})` }))} />
            </div>
          )}
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!target || !o?.canManage}>
              Add
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
