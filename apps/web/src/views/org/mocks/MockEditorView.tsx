'use client'

// One mock API: endpoints on the left, the selected endpoint's responses on
// the right. Everything is a draft until Save (one request, version-checked),
// and "Try" runs the draft through the same engine the hub serves with.

import { useEffect, useMemo, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, Switch, Textarea, TextareaField, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import {
  mocksService,
  type MockApi,
  type MockEndpoint,
  type MockMethod,
  type MockMode,
  type MockResource,
  type MockResponse,
  type MockRule,
  type MockTryAnswer
} from '@/api/infrastructure/services/mocks.service'
import {
  LABEL_RE,
  METHODS,
  METHOD_VARIANT,
  RULE_OPS,
  RULE_SOURCES,
  STATUS_PRESETS,
  TEMPLATE_TAGS,
  bodyWarning,
  curlFor,
  duplicateEndpoint,
  examplePath,
  exampleUrl,
  fallbackResponse,
  formatBody,
  headersToRows,
  moveItem,
  newEndpoint,
  newResource,
  newResponse,
  pathParams,
  pathProblem,
  rowsToHeaders,
  setDefault,
  type HeaderRow
} from './mockForm'
import { mockKeys } from './MocksView'
import { ExportDialog, RecordDialog, ResourceEditor } from './MockPhase2Parts'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

type Draft = Pick<MockApi, 'name' | 'label' | 'description' | 'enabled' | 'mode' | 'cors' | 'latencyMs' | 'endpoints' | 'resources'>

const draftOf = (m: MockApi): Draft => ({
  name: m.name,
  label: m.label,
  description: m.description,
  enabled: m.enabled,
  mode: m.mode,
  cors: m.cors,
  latencyMs: m.latencyMs,
  endpoints: m.endpoints,
  resources: m.resources ?? []
})

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

export default function MockEditorView({ accountId, mockId }: { accountId: string; mockId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const router = useRouter()
  const { data: m, isLoading, error } = useQuery({ queryKey: mockKeys.one(accountId, mockId), queryFn: () => mocksService.get(accountId, mockId), enabled: ready })

  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<'try' | 'import' | 'delete' | 'export' | 'record' | null>(null)

  const d = draft ?? (m ? draftOf(m) : null)
  const dirty = !!m && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(m))
  const canEdit = !!m?.canManage
  const endpoint = d?.endpoints.find(e => e.id === selected) ?? null
  const resource = d?.resources.find(r => r.id === selected) ?? null

  useEffect(() => {
    if (!d || selected) return
    // ?endpoint=<id> (links shared in chat and issues) opens that endpoint.
    const wanted = new URLSearchParams(window.location.search).get('endpoint')

    if (wanted && d.endpoints.some(e => e.id === wanted)) setSelected(wanted)
    else if (d.endpoints.length) setSelected(d.endpoints[0].id)
  }, [d, selected])

  // Don't lose unsaved work to a closed tab.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()

    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => setDraft({ ...(d as Draft), ...patch })
  const setEndpoints = (fn: (eps: MockEndpoint[]) => MockEndpoint[]) => update({ endpoints: fn(d!.endpoints) })
  const patchEndpoint = (id: string, patch: Partial<MockEndpoint>) => setEndpoints(eps => eps.map(e => (e.id === id ? { ...e, ...patch } : e)))
  const patchResource = (id: string, patch: Partial<MockResource>) => update({ resources: d!.resources.map(r => (r.id === id ? { ...r, ...patch } : r)) })

  const save = useMutation({
    mutationFn: () => mocksService.save(accountId, mockId, { ...draft!, expectedVersion: m!.version }),
    onSuccess: saved => {
      qc.setQueryData(mockKeys.one(accountId, mockId), { ...m, ...saved })
      qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
      setDraft(null)
      toast.success('Saved. The mock answers with it now.')
    },
    onError: e => toast.danger((e as Error).message)
  })

  // Ctrl/Cmd+S saves.
  const saveRef = useRef(() => {})

  saveRef.current = () => {
    if (dirty && canEdit && !save.isPending) save.mutate()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()

    return (d?.endpoints ?? []).filter(e => !q || `${e.method} ${e.path} ${e.name ?? ''}`.toLowerCase().includes(q))
  }, [d, filter])

  if (isLoading || !ready) return <Skeleton height='24rem' />
  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (!m || !d) return null

  const atLimit = d.endpoints.length >= (m.maxEndpoints ?? 1000)
  const labelOk = LABEL_RE.test(d.label) && !d.label.includes('--')
  const baseUrl = m.url && d.label === m.label ? m.url : null


  return (
    <div className='flex flex-col gap-4'>
      {/* Header */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 20rem' }}>
          <Link href={`/organizations/${accountId}/mocks`} style={{ ...muted, fontSize: 13 }}>
            ← Mock APIs
          </Link>
          <div className='flex items-center gap-2 flex-wrap'>
            <Typography variant='h4' style={{ margin: 0 }}>
              {d.name || 'Untitled'}
            </Typography>
            <Badge size='sm' variant={d.enabled ? 'success' : 'default'}>
              {d.enabled ? 'answering' : 'off'}
            </Badge>
            {dirty && (
              <Badge size='sm' variant='warning'>
                unsaved
              </Badge>
            )}
          </div>
          {m.url && (
            <button type='button' onClick={() => copy(m.url!)} title='Copy URL' style={{ ...mono, textAlign: 'start', background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'copy', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.url}
            </button>
          )}
        </div>
        <div className='flex flex-wrap gap-2 items-center'>
          <Button size='sm' variant='outline' icon={<i className='tabler-player-play' />} onClick={() => setDialog('try')}>
            Try
          </Button>
          <Link href={`/organizations/${accountId}/inspector?label=${encodeURIComponent(m.label)}`}>
            <Button size='sm' variant='ghost' icon={<i className='tabler-radar-2' />}>
              Requests
            </Button>
          </Link>
          <Button size='sm' variant='ghost' icon={<i className='tabler-file-export' />} onClick={() => setDialog('export')}>
            Export
          </Button>
          {canEdit && (
            <Button size='sm' variant='ghost' icon={<i className='tabler-player-record' />} onClick={() => setDialog('record')} disabled={dirty} title={dirty ? 'Save or discard your changes first' : 'Create endpoints from captured traffic'}>
              Record
            </Button>
          )}
          {canEdit && (
            <Button size='sm' variant='ghost' icon={<i className='tabler-file-import' />} onClick={() => setDialog('import')} disabled={dirty} title={dirty ? 'Save or discard your changes first' : undefined}>
              Import
            </Button>
          )}
          {canEdit && dirty && (
            <Button size='sm' variant='secondary' onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          {canEdit && (
            <Button size='sm' onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !labelOk || !d.name.trim()} title='Save (Ctrl+S)'>
              Save
            </Button>
          )}
        </div>
      </div>

      {m.enabledOnPlatform === false && <Alert variant='info'>Mock APIs are switched off on this platform right now. Your changes are kept and answer once they are back.</Alert>}
      {!canEdit && <Alert variant='info'>Only owners and admins can change this mock. You can still try requests against it.</Alert>}

      {/* Settings */}
      <Card className='p-4'>
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))', alignItems: 'end' }}>
          <TextField name='name' label='Name' value={d.name} disabled={!canEdit} onChange={e => update({ name: e.target.value })} />
          <TextField
            name='label'
            label='Label'
            value={d.label}
            disabled={!canEdit}
            onChange={e => update({ label: e.target.value.toLowerCase() })}
            error={labelOk ? undefined : 'Lowercase letters, digits and single hyphens'}
            hint={labelOk && d.label !== m.label ? 'The URL changes when you save.' : undefined}
          />
          <SelectField
            name='mode'
            label='Answers'
            value={d.mode}
            disabled={!canEdit}
            onValueChange={v => update({ mode: v as MockMode })}
            options={[
              { value: 'ALWAYS', label: 'Mock first (agent gets the rest)' },
              { value: 'OFFLINE', label: 'Only while the agent is offline' }
            ]}
          />
          <TextField name='latency' type='number' label='Latency for every answer (ms)' min={0} max={30000} value={String(d.latencyMs)} disabled={!canEdit} onChange={e => update({ latencyMs: Math.max(0, Math.min(30000, Number(e.target.value) || 0)) })} />
          <div className='flex flex-col gap-2' style={{ paddingBlockEnd: 6 }}>
            <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
              <Switch checked={d.cors} disabled={!canEdit} onCheckedChange={(v: boolean) => update({ cors: v })} aria-label='CORS' /> CORS for browsers
            </label>
            <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
              <Switch checked={d.enabled} disabled={!canEdit} onCheckedChange={(v: boolean) => update({ enabled: v })} aria-label='Answering' /> Answering
            </label>
          </div>
        </div>
      </Card>

      {/* Endpoints + editor */}
      <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 19rem), 1fr))', alignItems: 'start' }}>
        <Card className='p-3' style={{ gridColumn: 'span 1', minInlineSize: 0 }}>
          <div className='flex flex-col gap-2'>
            <div className='flex gap-2 items-end'>
              <div style={{ flex: 1 }}>
                <TextField name='filter' label='Endpoints' placeholder='Filter' value={filter} onChange={e => setFilter(e.target.value)} />
              </div>
              {canEdit && (
                <Button
                  size='sm'
                  icon={<i className='tabler-plus' />}
                  disabled={atLimit}
                  title={atLimit ? `Your plan allows ${m.maxEndpoints} endpoints per mock` : 'Add an endpoint'}
                  onClick={() => {
                    const e = newEndpoint(d.endpoints)

                    setEndpoints(eps => [...eps, e])
                    setSelected(e.id)
                    setFilter('')
                  }}
                >
                  Add
                </Button>
              )}
            </div>
            <nav aria-label='Endpoints' className='flex flex-col' style={{ maxBlockSize: '62vh', overflowY: 'auto' }}>
              {visible.length === 0 && (
                <Typography variant='caption' style={{ ...muted, padding: 8 }}>
                  {d.endpoints.length ? 'Nothing matches the filter.' : 'No endpoints yet. Add one.'}
                </Typography>
              )}
              {visible.map(e => (
                <button
                  key={e.id}
                  type='button'
                  onClick={() => setSelected(e.id)}
                  aria-current={e.id === selected ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 0,
                    textAlign: 'start',
                    cursor: 'pointer',
                    color: 'inherit',
                    background: e.id === selected ? 'var(--vhyx-color-bg-muted)' : 'transparent',
                    opacity: e.enabled ? 1 : 0.5
                  }}
                >
                  <Badge size='sm' variant={METHOD_VARIANT[e.method]} style={{ minInlineSize: 52, justifyContent: 'center' }}>
                    {e.method}
                  </Badge>
                  <span className='flex flex-col' style={{ minInlineSize: 0 }}>
                    <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path}</span>
                    {e.name ? <span style={{ ...muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span> : null}
                  </span>
                </button>
              ))}
            </nav>
            <Typography variant='caption' style={muted}>
              {d.endpoints.length} of {m.maxEndpoints} endpoints. The first match from the top answers.
            </Typography>
            <div className='flex items-center justify-between gap-2' style={{ borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 10, marginBlockStart: 4 }}>
              <Typography variant='body2' style={{ fontWeight: 600 }}>
                Resources
              </Typography>
              {canEdit && (
                <Button
                  size='xs'
                  variant='ghost'
                  icon={<i className='tabler-plus' />}
                  disabled={d.resources.length >= 20}
                  onClick={() => {
                    const r = newResource(d.resources)

                    update({ resources: [...d.resources, r] })
                    setSelected(r.id)
                  }}
                >
                  Resource
                </Button>
              )}
            </div>
            {d.resources.length === 0 ? (
              <Typography variant='caption' style={muted}>
                A resource is a ready-made REST collection with stored data, like /users with list, create, read, update and delete.
              </Typography>
            ) : (
              d.resources.map(r => (
                <button
                  key={r.id}
                  type='button'
                  onClick={() => setSelected(r.id)}
                  aria-current={r.id === selected ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 0,
                    textAlign: 'start',
                    cursor: 'pointer',
                    color: 'inherit',
                    background: r.id === selected ? 'var(--vhyx-color-bg-muted)' : 'transparent',
                    opacity: r.enabled ? 1 : 0.5
                  }}
                >
                  <i className='tabler-database' aria-hidden style={{ color: 'var(--vhyx-color-accent)' }} />
                  <span style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.path}</span>
                  <span style={{ ...muted, fontSize: 12 }}>{r.seed.length} seed</span>
                </button>
              ))
            )}
          </div>
        </Card>

        <div style={{ gridColumn: 'span 2', minInlineSize: 0 }}>
          {resource ? (
            <ResourceEditor
              key={resource.id}
              accountId={accountId}
              mockId={mockId}
              r={resource}
              saved={m.resources?.find(x => x.id === resource.id)}
              baseUrl={baseUrl}
              canEdit={canEdit}
              onChange={patch => patchResource(resource.id, patch)}
              onDelete={() => {
                update({ resources: d.resources.filter(x => x.id !== resource.id) })
                setSelected(d.endpoints[0]?.id ?? null)
              }}
            />
          ) : endpoint ? (
            <EndpointEditor
              key={endpoint.id}
              e={endpoint}
              index={d.endpoints.findIndex(x => x.id === endpoint.id)}
              count={d.endpoints.length}
              baseUrl={baseUrl}
              canEdit={canEdit}
              atLimit={atLimit}
              onChange={patch => patchEndpoint(endpoint.id, patch)}
              onMove={dir => {
                const i = d.endpoints.findIndex(x => x.id === endpoint.id)

                setEndpoints(eps => moveItem(eps, i, i + dir))
              }}
              onDuplicate={() => {
                const copyOf = duplicateEndpoint(endpoint)
                const i = d.endpoints.findIndex(x => x.id === endpoint.id)

                setEndpoints(eps => [...eps.slice(0, i + 1), copyOf, ...eps.slice(i + 1)])
                setSelected(copyOf.id)
              }}
              onDelete={() => {
                const i = d.endpoints.findIndex(x => x.id === endpoint.id)
                const rest = d.endpoints.filter(x => x.id !== endpoint.id)

                update({ endpoints: rest })
                setSelected(rest[Math.min(i, rest.length - 1)]?.id ?? null)
              }}
            />
          ) : (
            <Card className='p-8'>
              <Typography variant='body2' style={muted}>
                Select an endpoint, or add one.
              </Typography>
            </Card>
          )}
        </div>
      </div>

      {canEdit && (
        <Card className='p-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <Typography variant='body2' style={{ fontWeight: 600 }}>
                Delete this mock API
              </Typography>
              <Typography variant='caption' style={muted}>
                Its URL stops answering at once (or goes back to the agent, if one runs on this label).
              </Typography>
            </div>
            <Button size='sm' variant='destructive' onClick={() => setDialog('delete')}>
              Delete
            </Button>
          </div>
        </Card>
      )}

      {dialog === 'export' && <ExportDialog accountId={accountId} mockId={mockId} dirty={dirty} onClose={() => setDialog(null)} />}
      {dialog === 'record' && (
        <RecordDialog
          accountId={accountId}
          mockId={mockId}
          defaultLabel={m.label}
          onClose={() => setDialog(null)}
          onDone={updated => {
            qc.setQueryData(mockKeys.one(accountId, mockId), { ...m, ...updated })
            qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
            setDraft(null)
          }}
        />
      )}
      {dialog === 'try' && <TryDialog accountId={accountId} mockId={mockId} draft={d} endpoint={endpoint} dirty={dirty} baseUrl={baseUrl} onClose={() => setDialog(null)} />}
      {dialog === 'import' && (
        <ImportDialog
          accountId={accountId}
          mockId={mockId}
          onClose={() => setDialog(null)}
          onDone={updated => {
            qc.setQueryData(mockKeys.one(accountId, mockId), { ...m, ...updated })
            qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
            setDraft(null)
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDelete
          name={m.name}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await mocksService.remove(accountId, mockId)
              qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
              toast.success(`${m.name} deleted`)
              router.push(`/organizations/${accountId}/mocks`)
            } catch (e) {
              toast.danger((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}

// ── Endpoint editor ───────────────────────────────────────────────────────────

function EndpointEditor(props: {
  e: MockEndpoint
  index: number
  count: number
  baseUrl: string | null
  canEdit: boolean
  atLimit: boolean
  onChange: (patch: Partial<MockEndpoint>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { e, canEdit, onChange } = props
  const [responseId, setResponseId] = useState(e.responses[0]?.id ?? '')
  const response = e.responses.find(r => r.id === responseId) ?? e.responses[0]
  const pathErr = pathProblem(e.path)
  const curl = curlFor(props.baseUrl, e)
  const url = exampleUrl(props.baseUrl, e)
  const selection = e.selection ?? 'rules'

  const patchResponse = (id: string, patch: Partial<MockResponse>) => onChange({ responses: e.responses.map(r => (r.id === id ? { ...r, ...patch } : r)) })

  return (
    <Card className='p-4'>
      <div className='flex flex-col gap-4'>
        <div className='grid gap-3' style={{ gridTemplateColumns: '8rem minmax(0, 1fr)', alignItems: 'start' }}>
          <SelectField name='method' label='Method' value={e.method} disabled={!canEdit} onValueChange={v => onChange({ method: v as MockMethod })} options={METHODS.map(x => ({ value: x, label: x }))} />
          <TextField
            name='path'
            label='Path'
            value={e.path}
            disabled={!canEdit}
            onChange={ev => onChange({ path: ev.target.value })}
            error={pathErr ?? undefined}
            hint={pathErr ? undefined : 'Use :id or {id} for a parameter and * for the rest of the path.'}
            style={mono}
          />
        </div>
        <TextField name='endpointName' label='Name (optional)' value={e.name ?? ''} disabled={!canEdit} onChange={ev => onChange({ name: ev.target.value })} placeholder='Get a user' />

        <div className='flex flex-wrap items-center gap-2'>
          <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
            <Switch checked={e.enabled} disabled={!canEdit} onCheckedChange={(v: boolean) => onChange({ enabled: v })} aria-label='Endpoint enabled' /> Enabled
          </label>
          <span style={{ flex: 1 }} />
          {curl && (
            <Button size='sm' variant='ghost' icon={<i className='tabler-copy' />} onClick={() => copy(curl)}>
              curl
            </Button>
          )}
          {url && e.method === 'GET' && (
            <a href={url} target='_blank' rel='noreferrer'>
              <Button size='sm' variant='ghost' icon={<i className='tabler-external-link' />}>
                Open
              </Button>
            </a>
          )}
          {canEdit && (
            <>
              <Button size='sm' variant='ghost' aria-label='Move up' disabled={props.index === 0} onClick={() => props.onMove(-1)}>
                <i className='tabler-arrow-up' aria-hidden />
              </Button>
              <Button size='sm' variant='ghost' aria-label='Move down' disabled={props.index === props.count - 1} onClick={() => props.onMove(1)}>
                <i className='tabler-arrow-down' aria-hidden />
              </Button>
              <Button size='sm' variant='ghost' disabled={props.atLimit} onClick={props.onDuplicate}>
                Duplicate
              </Button>
              <Button size='sm' variant='ghost' onClick={props.onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>

        <div style={{ borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 12 }} className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-end gap-3 justify-between'>
            <Typography variant='h6' style={{ margin: 0 }}>
              Responses
            </Typography>
            <div style={{ minInlineSize: 260 }}>
              <SelectField
                name='selection'
                label='Which response answers'
                size='sm'
                value={selection}
                disabled={!canEdit}
                onValueChange={v => onChange({ selection: v as MockEndpoint['selection'] })}
                options={[
                  { value: 'rules', label: 'First whose rules match, else the default' },
                  { value: 'sequential', label: 'Each in turn' },
                  { value: 'random', label: 'One at random' }
                ]}
              />
            </div>
          </div>

          <div role='tablist' aria-label='Responses' className='flex flex-wrap gap-2'>
            {e.responses.map(r => (
              <button
                key={r.id}
                type='button'
                role='tab'
                aria-selected={r.id === response?.id}
                onClick={() => setResponseId(r.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: `1px solid ${r.id === response?.id ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                <Badge size='sm' variant={r.status >= 500 ? 'danger' : r.status >= 400 ? 'warning' : r.status >= 300 ? 'info' : 'success'}>
                  {r.status}
                </Badge>
                {r.name || 'Response'}
                {selection === 'rules' && e.responses.length > 1 && fallbackResponse(e.responses)?.id === r.id ? <span style={muted}>· default</span> : null}
                {selection === 'rules' && r.rules?.length ? <span style={muted}>· {r.rules.length} rule{r.rules.length === 1 ? '' : 's'}</span> : null}
              </button>
            ))}
            {canEdit && e.responses.length < 20 && (
              <Button
                size='sm'
                variant='ghost'
                icon={<i className='tabler-plus' />}
                onClick={() => {
                  const r = newResponse({ name: 'Not found', status: 404, body: '{\n  "error": "Not found"\n}', rules: [{ source: 'query', key: 'missing', op: 'exists' }] })

                  onChange({ responses: [...e.responses, r] })
                  setResponseId(r.id)
                }}
              >
                Response
              </Button>
            )}
          </div>

          {response && (
            <ResponseEditor
              key={response.id}
              r={response}
              e={e}
              canEdit={canEdit}
              showRules={selection === 'rules'}
              isFallback={fallbackResponse(e.responses)?.id === response.id}
              canDelete={e.responses.length > 1}
              onChange={patch => patchResponse(response.id, patch)}
              onMakeDefault={() => onChange({ responses: setDefault(e.responses, response.id) })}
              onDelete={() => {
                const rest = e.responses.filter(x => x.id !== response.id)

                onChange({ responses: rest })
                setResponseId(rest[0]?.id ?? '')
              }}
            />
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Response editor ───────────────────────────────────────────────────────────

function ResponseEditor(props: {
  r: MockResponse
  e: MockEndpoint
  canEdit: boolean
  showRules: boolean
  /** Answers when no rules match (the engine's fallback). */
  isFallback: boolean
  canDelete: boolean
  onChange: (patch: Partial<MockResponse>) => void
  onMakeDefault: () => void
  onDelete: () => void
}) {
  const { r, canEdit, onChange } = props
  const [rows, setRows] = useState<HeaderRow[]>(() => headersToRows(r.headers))
  const body = useRef<HTMLTextAreaElement | null>(null)
  const warn = bodyWarning(r)
  const params = pathParams(props.e.path)

  const setHeaderRows = (next: HeaderRow[]) => {
    setRows(next)
    onChange({ headers: rowsToHeaders(next) })
  }

  function insertTag(tag: string) {
    const el = body.current
    const text = r.body ?? ''
    const at = el ? el.selectionStart : text.length
    const next = text.slice(0, at) + tag + text.slice(el ? el.selectionEnd : text.length)

    onChange({ body: next, templating: true })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + tag.length, at + tag.length)
    })
  }

  const setRule = (i: number, patch: Partial<MockRule>) => onChange({ rules: (r.rules ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) })

  return (
    <div className='flex flex-col gap-3'>
      <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))', alignItems: 'end' }}>
        <TextField name='responseName' label='Name' value={r.name ?? ''} disabled={!canEdit} onChange={ev => onChange({ name: ev.target.value })} />
        <TextField name='status' type='number' label='Status' min={100} max={599} value={String(r.status)} disabled={!canEdit} onChange={ev => onChange({ status: Number(ev.target.value) || 200 })} list='mock-status-presets' />
        <TextField name='latency' type='number' label='Extra delay (ms)' min={0} max={30000} value={String(r.latencyMs ?? 0)} disabled={!canEdit} onChange={ev => onChange({ latencyMs: Math.max(0, Math.min(30000, Number(ev.target.value) || 0)) })} />
      </div>
      <datalist id='mock-status-presets'>
        {STATUS_PRESETS.map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {props.showRules && (
        <div className='flex flex-col gap-2' style={{ padding: 12, borderRadius: 10, background: 'var(--vhyx-color-bg-muted)' }}>
          <div className='flex flex-wrap items-center gap-2 justify-between'>
            <Typography variant='body2' style={{ fontWeight: 600 }}>
              {props.isFallback
                ? props.e.responses.length === 1
                  ? 'Answers every request to this endpoint'
                  : 'Answers when no other response’s rules match'
                : r.rules?.length
                  ? 'Answers when'
                  : 'Not used: another response is the fallback. Add a rule, or make this one the default'}
            </Typography>
            <div className='flex gap-2 items-center'>
              {!props.isFallback && canEdit && (
                <Button size='xs' variant='ghost' onClick={props.onMakeDefault}>
                  Make default
                </Button>
              )}
              {(r.rules?.length ?? 0) > 1 && (
                <div style={{ minInlineSize: 150 }}>
                  <SelectField
                    name='rulesMatch'
                    label='Match'
                    size='sm'
                    value={r.rulesMatch ?? 'all'}
                    disabled={!canEdit}
                    onValueChange={v => onChange({ rulesMatch: v as 'all' | 'any' })}
                    options={[
                      { value: 'all', label: 'all rules' },
                      { value: 'any', label: 'any rule' }
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
          {(r.rules ?? []).map((rule, i) => {
            const src = RULE_SOURCES.find(s => s.value === rule.source)
            const op = RULE_OPS.find(o => o.value === rule.op)

            return (
              <div key={i} className='grid gap-2' style={{ gridTemplateColumns: 'minmax(8rem, 1.2fr) minmax(6rem, 1fr) minmax(7rem, 1fr) minmax(6rem, 1fr) auto', alignItems: 'end' }}>
                <SelectField name={`src-${i}`} label='Where' size='sm' value={rule.source} disabled={!canEdit} onValueChange={v => setRule(i, { source: v as MockRule['source'] })} options={RULE_SOURCES.map(s => ({ value: s.value, label: s.label }))} />
                <TextField
                  name={`key-${i}`}
                  label='Name'
                  value={rule.key ?? ''}
                  disabled={!canEdit || (!src?.needsKey && rule.source !== 'body')}
                  placeholder={rule.source === 'param' && params.length ? params[0] : src?.keyHint}
                  onChange={ev => setRule(i, { key: ev.target.value })}
                />
                <SelectField name={`op-${i}`} label='Test' size='sm' value={rule.op} disabled={!canEdit} onValueChange={v => setRule(i, { op: v as MockRule['op'] })} options={RULE_OPS.map(o => ({ value: o.value, label: o.label }))} />
                <TextField name={`value-${i}`} label='Value' value={rule.value ?? ''} disabled={!canEdit || !op?.needsValue} onChange={ev => setRule(i, { value: ev.target.value })} />
                {canEdit ? (
                  <Button size='sm' variant='ghost' aria-label='Remove rule' onClick={() => onChange({ rules: (r.rules ?? []).filter((_, j) => j !== i) })}>
                    <i className='tabler-x' aria-hidden />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            )
          })}
          {canEdit && (r.rules?.length ?? 0) < 10 && (
            <div>
              <Button size='xs' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => onChange({ rules: [...(r.rules ?? []), { source: params.length ? 'param' : 'query', key: params[0] ?? '', op: 'equals', value: '' }] })}>
                Rule
              </Button>
            </div>
          )}
        </div>
      )}

      <div className='flex flex-col gap-2'>
        <Typography variant='body2' style={{ fontWeight: 600 }}>
          Headers
        </Typography>
        {rows.map((row, i) => (
          <div key={i} className='grid gap-2' style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr) auto' }}>
            <TextField name={`hk-${i}`} label='' aria-label='Header name' value={row.key} disabled={!canEdit} placeholder='content-type' onChange={ev => setHeaderRows(rows.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)))} style={mono} />
            <TextField name={`hv-${i}`} label='' aria-label='Header value' value={row.value} disabled={!canEdit} placeholder='application/json' onChange={ev => setHeaderRows(rows.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} style={mono} />
            {canEdit ? (
              <Button size='sm' variant='ghost' aria-label='Remove header' onClick={() => setHeaderRows(rows.filter((_, j) => j !== i))}>
                <i className='tabler-x' aria-hidden />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {canEdit && (
          <div>
            <Button size='xs' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => setHeaderRows([...rows, { key: '', value: '' }])}>
              Header
            </Button>
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Typography variant='body2' style={{ fontWeight: 600 }}>
            Body
          </Typography>
          <div className='flex items-center gap-3'>
            <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
              <Switch checked={!!r.templating} disabled={!canEdit} onCheckedChange={(v: boolean) => onChange({ templating: v })} aria-label='Templating' /> Templating
            </label>
            {canEdit && (
              <Button
                size='xs'
                variant='ghost'
                onClick={() => {
                  const f = formatBody(r.body ?? '')

                  if (f.error) toast.danger(`Not JSON: ${f.error}`)
                  else onChange({ body: f.body })
                }}
              >
                Format JSON
              </Button>
            )}
          </div>
        </div>
        <Textarea ref={body} name='body' aria-label='Response body' rows={12} value={r.body ?? ''} disabled={!canEdit} onChange={ev => onChange({ body: ev.target.value })} style={{ ...mono, lineHeight: 1.5 }} spellCheck={false} />
        {warn && (
          <Typography variant='caption' style={{ color: 'var(--vhyx-color-warning)' }}>
            {warn}
          </Typography>
        )}
        {canEdit && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, ...muted }}>Templating cheat sheet: click a tag to insert it (turns templating on)</summary>
            <div className='grid gap-1' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 17rem), 1fr))', marginBlockStart: 8 }}>
              {TEMPLATE_TAGS.map(t => (
                <button key={t.tag} type='button' onClick={() => insertTag(t.tag)} style={{ textAlign: 'start', background: 'none', border: '1px solid var(--vhyx-color-border)', borderRadius: 8, padding: '6px 8px', color: 'inherit', cursor: 'pointer' }}>
                  <span style={{ ...mono, color: 'var(--vhyx-color-accent)' }}>{t.tag}</span>
                  <span style={{ ...muted, fontSize: 12, display: 'block' }}>{t.help}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      {canEdit && props.canDelete && (
        <div>
          <Button size='sm' variant='ghost' onClick={props.onDelete}>
            Delete this response
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const line of text.split('\n')) {
    const i = line.indexOf(':')

    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }

  return out
}

function TryDialog(props: { accountId: string; mockId: string; draft: Draft; endpoint: MockEndpoint | null; dirty: boolean; baseUrl: string | null; onClose: () => void }) {
  const ep = props.endpoint
  const [method, setMethod] = useState<string>(ep && ep.method !== 'ANY' ? ep.method : 'GET')
  const [path, setPath] = useState(ep ? examplePath(ep) : '/')
  const [headers, setHeaders] = useState(ep && ['POST', 'PUT', 'PATCH'].includes(ep.method) ? 'content-type: application/json' : '')
  const [body, setBody] = useState(ep && ['POST', 'PUT', 'PATCH'].includes(ep.method) ? '{\n  "email": "ada@example.com"\n}' : '')
  const [answer, setAnswer] = useState<MockTryAnswer | null>(null)

  const run = useMutation({
    mutationFn: () =>
      mocksService.try(props.accountId, props.mockId, {
        method,
        path: path.startsWith('/') ? path : `/${path}`,
        headers: parseHeaderLines(headers),
        body: body || undefined,
        // Unsaved edits are tried as they are on screen.
        definition: props.dirty ? { mode: props.draft.mode, cors: props.draft.cors, latencyMs: props.draft.latencyMs, endpoints: props.draft.endpoints } : undefined
      }),
    onSuccess: setAnswer,
    onError: e => toast.danger((e as Error).message)
  })

  const matched = answer && answer.matched ? answer : null
  const epName = matched ? props.draft.endpoints.find(x => x.id === matched.endpointId) : null
  const respName = matched && epName ? epName.responses.find(x => x.id === matched.responseId)?.name : null

  return (
    <Dialog open onOpenChange={next => !next && props.onClose()} size='lg'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Try a request{props.dirty ? ' (with your unsaved changes)' : ''}</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              run.mutate()
            }}
          >
            <div className='grid gap-3' style={{ gridTemplateColumns: '8rem minmax(0, 1fr)', alignItems: 'end' }}>
              <SelectField name='tryMethod' label='Method' value={method} onValueChange={setMethod} options={METHODS.filter(m => m !== 'ANY').map(m => ({ value: m, label: m }))} />
              <TextField name='tryPath' label='Path and query' value={path} onChange={e => setPath(e.target.value)} style={mono} />
            </div>
            <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))' }}>
              <TextareaField name='tryHeaders' label='Headers' rows={4} value={headers} onChange={e => setHeaders(e.target.value)} hint='name: value, one per line' style={mono} />
              <TextareaField name='tryBody' label='Body' rows={4} value={body} onChange={e => setBody(e.target.value)} style={mono} />
            </div>
            <div className='flex gap-2 items-center'>
              <Button type='submit' loading={run.isPending} icon={<i className='tabler-player-play' />}>
                Send
              </Button>
              {props.baseUrl && (
                <Button type='button' variant='ghost' icon={<i className='tabler-copy' />} onClick={() => copy(`curl -i ${method === 'GET' ? '' : `-X ${method} `}'${props.baseUrl}${path}'`)}>
                  curl for the live URL
                </Button>
              )}
            </div>
          </form>

          {answer && !answer.matched && (
            <Alert variant='warning' style={{ marginBlockStart: 12 }}>
              No endpoint matches {method} {path.split('?')[0]}. The live URL answers 404 (or forwards it to the agent, if one is connected).
            </Alert>
          )}
          {matched && (
            <div className='flex flex-col gap-2' style={{ marginBlockStart: 12 }}>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={matched.status >= 500 ? 'danger' : matched.status >= 400 ? 'warning' : 'success'}>{matched.status}</Badge>
                <Typography variant='body2'>
                  {epName ? `${epName.method} ${epName.path}` : matched.endpointId === 'cors' ? 'CORS preflight' : ''}
                  {respName ? ` → ${respName}` : ''}
                </Typography>
                {matched.latencyMs > 0 && (
                  <Typography variant='caption' style={muted}>
                    after {matched.latencyMs} ms on the live URL
                  </Typography>
                )}
              </div>
              <pre style={{ ...mono, margin: 0, padding: 10, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', whiteSpace: 'pre-wrap', maxBlockSize: 120, overflow: 'auto' }}>
                {Object.entries(matched.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n')}
              </pre>
              <pre style={{ ...mono, margin: 0, padding: 10, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', whiteSpace: 'pre-wrap', maxBlockSize: 320, overflow: 'auto' }}>
                {prettyMaybe(matched.body) || '(empty body)'}
              </pre>
            </div>
          )}
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={props.onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function prettyMaybe(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function ImportDialog({ accountId, mockId, onClose, onDone }: { accountId: string; mockId: string; onClose: () => void; onDone: (m: MockApi) => void }) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const run = useMutation({
    mutationFn: () => mocksService.import(accountId, mockId, text, replace),
    onSuccess: r => {
      onDone(r.mock)
      toast.success(`Imported ${r.added} endpoint${r.added === 1 ? '' : 's'}${r.addedResources ? ` and ${r.addedResources} resource${r.addedResources === 1 ? '' : 's'}` : ''}${r.skipped ? `; ${r.skipped} already existed` : ''}`)
      for (const w of r.warnings.slice(0, 3)) toast.info(w)
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Import endpoints</Dialog.Title>
          <div className='flex flex-col gap-3'>
            <TextareaField name='document' label='OpenAPI, Postman, Mockoon, HAR or VhyxVoid export (JSON or YAML)' rows={10} value={text} onChange={e => setText(e.target.value)} hint='The format is detected for you.' style={mono} />
            <div className='flex items-center gap-2 flex-wrap'>
              <input
                ref={file}
                type='file'
                accept='.json,.yaml,.yml,.har'
                hidden
                onChange={async e => {
                  const f = e.target.files?.[0]

                  if (f) setText(await f.text())
                }}
              />
              <Button type='button' size='sm' variant='outline' onClick={() => file.current?.click()}>
                Upload a file
              </Button>
              <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
                <Switch checked={replace} onCheckedChange={setReplace} aria-label='Replace' /> Replace all endpoints
              </label>
            </div>
            <Typography variant='caption' style={muted}>
              {replace ? 'Every current endpoint and resource is removed first.' : 'Routes and resources the mock already has are kept as they are; new ones are added at the end.'} The import is saved at once.
            </Typography>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={text.trim().length < 10}>
              Import
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function ConfirmDelete({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Delete {name}?</Dialog.Title>
          <Typography variant='body2'>Its endpoints and responses are removed and its URL stops answering. This can’t be undone; export it as OpenAPI first if you may need it.</Typography>
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              loading={busy}
              onClick={async () => {
                setBusy(true)
                await onConfirm()
                setBusy(false)
              }}
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

