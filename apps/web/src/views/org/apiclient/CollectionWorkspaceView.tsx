'use client'

// One collection: requests and folders on the left, the selected request in
// the middle, its last response below. The collection is a draft until Save
// (one version-checked request); Send always uses what is on screen, through
// the platform's runner (no CORS, public addresses only).
//
// Keys: Ctrl/Cmd+Enter sends, Ctrl/Cmd+S saves.

import { useEffect, useMemo, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, Input, SelectField, Skeleton, Tabs, Textarea, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { apiClientService, type ApiFolder, type ApiRequest, type Collection, type ParsedDocument } from '@/api/infrastructure/services/apiClient.service'
import { METHODS, METHOD_VARIANT, applyUrlInput, buildTree, download, duplicateRequest, folderDescendants, joinUrl, newRequest, statusVariant, suggestAssertions, uid, undefinedVars, type TreeNode } from './apiClientForm'
import { apiClientKeys } from './ApiClientView'
import {
  AuthEditor,
  BodyEditor,
  COMMON_HEADERS,
  CapturesEditor,
  ChecksEditor,
  CollectionSettingsDialog,
  EnvironmentsDialog,
  ImportIntoDialog,
  KeyValueEditor,
  ResponseView,
  RunDialog,
  SnippetDialog,
  authSummary,
  mono,
  muted,
  type SendOutcome
} from './ApiClientParts'

type Draft = Pick<Collection, 'name' | 'description' | 'auth' | 'variables' | 'folders' | 'requests'>

const draftOf = (c: Collection): Draft => ({ name: c.name, description: c.description, auth: c.auth, variables: c.variables, folders: c.folders, requests: c.requests })

type Outcome = SendOutcome | { problems: string[] }
type DialogName = 'settings' | 'envs' | 'code' | 'run' | 'import' | 'delete' | 'export' | null

const envKey = (id: string) => `vv.apiclient.env.${id}`

export default function CollectionWorkspaceView({ accountId, collectionId }: { accountId: string; collectionId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const router = useRouter()
  const { data: c, isLoading, error } = useQuery({ queryKey: apiClientKeys.collection(accountId, collectionId), queryFn: () => apiClientService.collection(accountId, collectionId), enabled: ready })
  const { data: o } = useQuery({ queryKey: apiClientKeys.overview(accountId), queryFn: () => apiClientService.overview(accountId), enabled: ready })

  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [side, setSide] = useState<'requests' | 'history'>('requests')
  const [tab, setTab] = useState('params')
  const [dialog, setDialog] = useState<DialogName>(null)
  const [envId, setEnvIdState] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<Record<string, string>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const d = draft ?? (c ? draftOf(c) : null)
  const dirty = !!c && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(c))
  const req = d?.requests.find(r => r.id === selected) ?? null
  const environments = useMemo(() => o?.environments ?? [], [o])
  const env = environments.find(e => e.id === envId) ?? null

  // The environment choice is remembered per collection, in this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(envKey(collectionId))

      if (saved) setEnvIdState(saved)
    } catch {
      /* storage blocked */
    }
  }, [collectionId])

  const setEnvId = (id: string | null) => {
    setEnvIdState(id)
    try {
      if (id) localStorage.setItem(envKey(collectionId), id)
      else localStorage.removeItem(envKey(collectionId))
    } catch {
      /* storage blocked */
    }
  }

  useEffect(() => {
    if (!d || selected) return
    // ?request=<id> (links shared in chat and issues) opens that request.
    const wanted = new URLSearchParams(window.location.search).get('request')

    if (wanted && d.requests.some(r => r.id === wanted)) setSelected(wanted)
    else if (d.requests.length) setSelected(d.requests[0].id)
  }, [d, selected])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()

    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => setDraft({ ...(d as Draft), ...patch })
  const patchRequest = (id: string, patch: Partial<ApiRequest>) => update({ requests: d!.requests.map(r => (r.id === id ? { ...r, ...patch } : r)) })

  const save = useMutation({
    mutationFn: () => apiClientService.saveCollection(accountId, collectionId, { ...draft!, expectedVersion: c!.version }),
    onSuccess: saved => {
      qc.setQueryData(apiClientKeys.collection(accountId, collectionId), { ...c, ...saved })
      qc.invalidateQueries({ queryKey: apiClientKeys.overview(accountId) })
      setDraft(null)
      toast.success('Saved')
    },
    onError: e => toast.danger((e as Error).message)
  })

  const send = useMutation({
    mutationFn: (r: ApiRequest) => apiClientService.send(accountId, { request: r, collectionId, collection: { variables: d!.variables, auth: d!.auth }, environmentId: envId, runtime }),
    onSuccess: (res, r) => {
      if (!res.sent) {
        setOutcomes(prev => ({ ...prev, [r.id]: { problems: res.problems } }))

        return
      }

      setOutcomes(prev => ({ ...prev, [r.id]: res }))
      const got = res.captures.filter(x => x.ok && x.value !== undefined)

      if (got.length) {
        setRuntime(prev => ({ ...prev, ...Object.fromEntries(got.map(x => [x.variable, x.value!])) }))
        toast.success(`Captured ${got.map(x => `{{${x.variable}}}`).join(', ')}`)
      }

      qc.invalidateQueries({ queryKey: apiClientKeys.history(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const keys = useRef({ save: () => {}, send: () => {} })

  keys.current = {
    save: () => dirty && !save.isPending && save.mutate(),
    send: () => req && !send.isPending && send.mutate(req)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return

      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        keys.current.save()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        keys.current.send()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tree = useMemo(() => (d ? buildTree(d.folders, d.requests, filter) : []), [d, filter])

  if (isLoading || !ready) return <Skeleton height='28rem' />
  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (!c || !d) return null

  const maxRequests = c.maxRequests ?? o?.maxRequests ?? 50
  const atLimit = d.requests.length >= maxRequests

  const addRequest = (folderId: string | null = req?.folderId ?? null, over: Partial<ApiRequest> = {}) => {
    if (atLimit) return toast.warning(`Your plan allows ${maxRequests} requests in a collection`)
    const r = newRequest({ folderId, ...over })

    update({ requests: [...d.requests, r] })
    setSelected(r.id)
    setTab('params')
    setFilter('')
  }

  const addFolder = (parentId: string | null = null) => {
    const f: ApiFolder = { id: uid('f'), name: 'New folder', parentId }

    update({ folders: [...d.folders, f] })
  }

  const renameFolder = (id: string, name: string) => update({ folders: d.folders.map(f => (f.id === id ? { ...f, name } : f)) })

  const removeFolder = (id: string) => {
    const gone = folderDescendants(d.folders, id)
    const parent = d.folders.find(f => f.id === id)?.parentId ?? null

    update({ folders: d.folders.filter(f => !gone.has(f.id)), requests: d.requests.map(r => (r.folderId && gone.has(r.folderId) ? { ...r, folderId: parent } : r)) })
  }

  const removeRequest = (id: string) => {
    const i = d.requests.findIndex(r => r.id === id)
    const rest = d.requests.filter(r => r.id !== id)

    update({ requests: rest })
    setSelected(rest[Math.min(i, rest.length - 1)]?.id ?? null)
  }

  const addParsed = (p: ParsedDocument) => {
    const room = maxRequests - d.requests.length

    if (room <= 0) return toast.warning(`Your plan allows ${maxRequests} requests in a collection`)
    const many = p.collection.requests.length > 1
    const top = many ? { id: uid('f'), name: p.collection.name.slice(0, 80) || 'Imported', parentId: null } : null
    const idMap = new Map(p.collection.folders.map(f => [f.id, uid('f')]))
    const folders = p.collection.folders.map(f => ({ id: idMap.get(f.id)!, name: f.name, parentId: f.parentId ? idMap.get(f.parentId) ?? top?.id ?? null : top?.id ?? null }))
    const requests = p.collection.requests.slice(0, room).map(r => ({ ...r, id: uid('q'), folderId: r.folderId ? idMap.get(r.folderId) ?? top?.id ?? null : top?.id ?? req?.folderId ?? null }))
    const newVars = p.collection.variables.filter(v => !d.variables.some(x => x.key === v.key))

    update({ folders: [...d.folders, ...(top ? [top] : []), ...folders], requests: [...d.requests, ...requests], variables: [...d.variables, ...newVars] })
    if (requests[0]) setSelected(requests[0].id)
    toast.success(`Added ${requests.length} request${requests.length === 1 ? '' : 's'}${newVars.length ? ` and ${newVars.length} variable${newVars.length === 1 ? '' : 's'}` : ''}`)
    if (requests.length < p.collection.requests.length) toast.warning(`${p.collection.requests.length - requests.length} left out: the plan's limit is ${maxRequests} per collection`)
  }

  const defined = new Set([...d.variables.filter(v => v.enabled).map(v => v.key), ...(env?.variables.filter(v => v.enabled).map(v => v.key) ?? []), ...Object.keys(runtime)])
  const missing = req ? undefinedVars(req, defined) : []
  const outcome = req ? outcomes[req.id] : undefined

  return (
    <div className='flex flex-col gap-4'>
      {/* Header */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 18rem' }}>
          <Link href={`/organizations/${accountId}/api-client`} style={{ ...muted, fontSize: 13 }}>
            ← API client
          </Link>
          <div className='flex items-center gap-2 flex-wrap'>
            <Typography variant='h4' style={{ margin: 0 }}>
              {d.name}
            </Typography>
            <Badge size='sm' variant='outline'>
              {d.requests.length} request{d.requests.length === 1 ? '' : 's'}
            </Badge>
            {dirty && (
              <Badge size='sm' variant='warning'>
                unsaved
              </Badge>
            )}
          </div>
        </div>
        <div className='flex flex-wrap gap-2 items-end'>
          <div style={{ minInlineSize: '11rem' }}>
            <SelectField name='environment' size='sm' value={envId ?? ''} onValueChange={v => setEnvId(v || null)} options={[{ value: '', label: 'No environment' }, ...environments.map(e => ({ value: e.id, label: e.name }))]} />
          </div>
          <Button size='sm' variant='ghost' icon={<i className='tabler-variable' />} onClick={() => setDialog('envs')} title='Environments'>
            Environments
          </Button>
          <Button size='sm' variant='ghost' icon={<i className='tabler-settings' />} onClick={() => setDialog('settings')}>
            Settings
          </Button>
          <Button size='sm' variant='outline' icon={<i className='tabler-player-play' />} onClick={() => setDialog('run')} disabled={!d.requests.length}>
            Run
          </Button>
          <Button size='sm' variant='ghost' icon={<i className='tabler-file-export' />} onClick={() => setDialog('export')} disabled={dirty} title={dirty ? 'Save first' : 'Export'}>
            Export
          </Button>
          {dirty && (
            <Button size='sm' variant='secondary' onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button size='sm' onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty} title='Save (Ctrl+S)'>
            Save
          </Button>
        </div>
      </div>

      {o && !o.enabled && <Alert variant='info'>The API client is switched off on this platform right now; sending and runs are paused.</Alert>}

      <div className='flex flex-wrap gap-4' style={{ alignItems: 'flex-start' }}>
        {/* Sidebar */}
        <Card className='p-3' style={{ flex: '1 1 16rem', maxInlineSize: '100%', minInlineSize: 0 }}>
          <div className='flex flex-col gap-2' style={{ maxInlineSize: '24rem' }}>
            <Tabs value={side} onValueChange={v => setSide(v as 'requests' | 'history')} variant='pills' size='sm'>
              <Tabs.List>
                <Tabs.Trigger value='requests'>Requests</Tabs.Trigger>
                <Tabs.Trigger value='history'>History</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value='requests'>
                <div className='flex flex-col gap-2 mbs-2'>
                  <Input size='sm' aria-label='Filter requests' placeholder='Filter' value={filter} onChange={e => setFilter(e.target.value)} icon={<i className='tabler-search' />} />
                  <div className='flex gap-1 flex-wrap'>
                    <Button size='sm' icon={<i className='tabler-plus' />} onClick={() => addRequest()} disabled={atLimit} title={atLimit ? `Your plan allows ${maxRequests} requests` : 'New request'}>
                      Request
                    </Button>
                    <Button size='sm' variant='ghost' icon={<i className='tabler-folder-plus' />} onClick={() => addFolder()}>
                      Folder
                    </Button>
                    <Button size='sm' variant='ghost' icon={<i className='tabler-file-import' />} onClick={() => setDialog('import')} title='Paste curl, Postman, OpenAPI or HAR'>
                      Import
                    </Button>
                  </div>
                  <nav aria-label='Requests' className='flex flex-col' style={{ maxBlockSize: '62vh', overflowY: 'auto' }}>
                    {tree.length === 0 && (
                      <Typography variant='caption' style={{ ...muted, padding: 8 }}>
                        {d.requests.length ? 'Nothing matches the filter.' : 'No requests yet. Add one or import a curl command.'}
                      </Typography>
                    )}
                    <TreeList
                      nodes={tree}
                      selected={selected}
                      collapsed={collapsed}
                      outcomes={outcomes}
                      onSelect={id => setSelected(id)}
                      onToggle={id => setCollapsed(prev => {
                        const next = new Set(prev)

                        if (next.has(id)) next.delete(id)
                        else next.add(id)

                        return next
                      })}
                      onRenameFolder={renameFolder}
                      onRemoveFolder={removeFolder}
                      onAddInFolder={id => addRequest(id)}
                      onAddSubfolder={id => addFolder(id)}
                    />
                  </nav>
                  <Typography variant='caption' style={muted}>
                    {d.requests.length} of {maxRequests} requests
                  </Typography>
                </div>
              </Tabs.Content>
              <Tabs.Content value='history'>
                <HistoryList
                  accountId={accountId}
                  onOpen={(r, out) => {
                    if (atLimit) return toast.warning(`Your plan allows ${maxRequests} requests in a collection`)
                    const copyReq = { ...r, id: uid('q'), name: r.name === 'Request' ? `${r.method} ${r.url}`.slice(0, 120) : r.name, folderId: null }

                    update({ requests: [...d.requests, copyReq] })
                    setSelected(copyReq.id)
                    if (out) setOutcomes(prev => ({ ...prev, [copyReq.id]: out }))
                    setSide('requests')
                    toast.success('Added to the collection (unsaved)')
                  }}
                />
              </Tabs.Content>
            </Tabs>
          </div>
        </Card>

        {/* Request + response */}
        <div className='flex flex-col gap-4' style={{ flex: '999 1 32rem', minInlineSize: 0 }}>
          {!req ? (
            <Card className='p-8'>
              <div className='flex flex-col items-center gap-3' style={{ textAlign: 'center' }}>
                <i className='tabler-send' style={{ fontSize: 36, ...muted }} aria-hidden />
                <Typography variant='h6'>Pick a request or add one</Typography>
                <div className='flex gap-2'>
                  <Button icon={<i className='tabler-plus' />} onClick={() => addRequest(null)} disabled={atLimit}>
                    New request
                  </Button>
                  <Button variant='outline' icon={<i className='tabler-terminal' />} onClick={() => setDialog('import')}>
                    Paste curl
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <Card className='p-4'>
                <div className='flex flex-col gap-3'>
                  <div className='flex flex-wrap items-end gap-2'>
                    <div style={{ flex: '1 1 14rem', minInlineSize: 0 }}>
                      <TextField name='req-name' label='Name' size='sm' value={req.name} onChange={e => patchRequest(req.id, { name: e.target.value.slice(0, 120) })} />
                    </div>
                    <div style={{ minInlineSize: '10rem' }}>
                      <SelectField name='req-folder' label='Folder' size='sm' value={req.folderId ?? ''} onValueChange={v => patchRequest(req.id, { folderId: v || null })} options={[{ value: '', label: '(top level)' }, ...d.folders.map(f => ({ value: f.id, label: f.name }))]} />
                    </div>
                    <Button size='sm' variant='ghost' icon={<i className='tabler-code' />} onClick={() => setDialog('code')}>
                      Code
                    </Button>
                    <Button size='sm' variant='ghost' icon={<i className='tabler-copy' />} onClick={() => (atLimit ? toast.warning(`Your plan allows ${maxRequests} requests`) : (() => {
                      const dup = duplicateRequest(req)
                      const i = d.requests.findIndex(r => r.id === req.id)

                      update({ requests: [...d.requests.slice(0, i + 1), dup, ...d.requests.slice(i + 1)] })
                      setSelected(dup.id)
                    })())}>
                      Duplicate
                    </Button>
                    <Button size='sm' variant='ghost' icon={<i className='tabler-trash' />} onClick={() => removeRequest(req.id)} aria-label='Delete request'>
                      Delete
                    </Button>
                  </div>

                  {/* URL bar */}
                  <form
                    className='flex flex-wrap gap-2 items-stretch'
                    onSubmit={e => {
                      e.preventDefault()
                      send.mutate(req)
                    }}
                  >
                    <div style={{ inlineSize: '7.5rem' }}>
                      <SelectField name='method' value={req.method} onValueChange={v => patchRequest(req.id, { method: v as ApiRequest['method'] })} options={METHODS.map(m => ({ value: m, label: m }))} />
                    </div>
                    <div style={{ flex: '1 1 16rem', minInlineSize: 0 }}>
                      <Input aria-label='URL' placeholder='{{baseUrl}}/users or https://api.example.com/users' value={joinUrl(req.url, req.params)} onChange={e => patchRequest(req.id, applyUrlInput(req, e.target.value))} spellCheck={false} style={mono} />
                    </div>
                    <Button type='submit' icon={<i className='tabler-send' />} loading={send.isPending} disabled={o ? !o.enabled : false} title='Send (Ctrl+Enter)'>
                      Send
                    </Button>
                  </form>
                  {missing.length > 0 && (
                    <Typography variant='caption' style={{ color: 'var(--vhyx-color-warning)' }}>
                      Not defined{env ? ` in ${env.name} or the collection` : ' (pick an environment, or add them in Settings)'}: {missing.map(m => `{{${m}}}`).join(', ')}
                    </Typography>
                  )}

                  <Tabs value={tab} onValueChange={setTab} variant='underline' size='sm'>
                    <Tabs.List style={{ overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'thin' }}>
                      <Tabs.Trigger value='params'>Params{count(req.params)}</Tabs.Trigger>
                      <Tabs.Trigger value='headers'>Headers{count(req.headers)}</Tabs.Trigger>
                      <Tabs.Trigger value='auth'>Auth</Tabs.Trigger>
                      <Tabs.Trigger value='body'>Body{req.body.type !== 'none' ? ' •' : ''}</Tabs.Trigger>
                      <Tabs.Trigger value='checks'>Checks{req.assertions.length ? ` (${req.assertions.length})` : ''}</Tabs.Trigger>
                      <Tabs.Trigger value='capture'>Capture{req.captures.length ? ` (${req.captures.length})` : ''}</Tabs.Trigger>
                      <Tabs.Trigger value='notes'>Notes</Tabs.Trigger>
                    </Tabs.List>
                    <div className='mbs-3'>
                      <Tabs.Content value='params'>
                        <KeyValueEditor rows={req.params} onChange={params => patchRequest(req.id, { params })} keyLabel='Parameter' />
                      </Tabs.Content>
                      <Tabs.Content value='headers'>
                        <KeyValueEditor rows={req.headers} onChange={headers => patchRequest(req.id, { headers })} keyLabel='Header' suggestions={COMMON_HEADERS} />
                      </Tabs.Content>
                      <Tabs.Content value='auth'>
                        <AuthEditor auth={req.auth} onChange={auth => patchRequest(req.id, { auth })} inheritedLabel={authSummary(d.auth)} />
                      </Tabs.Content>
                      <Tabs.Content value='body'>
                        <BodyEditor body={req.body} onChange={body => patchRequest(req.id, { body })} />
                      </Tabs.Content>
                      <Tabs.Content value='checks'>
                        <ChecksEditor list={req.assertions} onChange={assertions => patchRequest(req.id, { assertions })} results={outcome && 'assertions' in outcome ? outcome.assertions : undefined} />
                      </Tabs.Content>
                      <Tabs.Content value='capture'>
                        <CapturesEditor list={req.captures} onChange={captures => patchRequest(req.id, { captures })} results={outcome && 'captures' in outcome ? outcome.captures : undefined} />
                      </Tabs.Content>
                      <Tabs.Content value='notes'>
                        <Textarea aria-label='Notes' rows={6} value={req.description ?? ''} onChange={e => patchRequest(req.id, { description: e.target.value.slice(0, 2000) })} placeholder='What this request is for, what to watch out for. Your team sees this.' />
                      </Tabs.Content>
                    </div>
                  </Tabs>
                </div>
              </Card>

              <Card className='p-4' aria-live='polite'>
                {send.isPending ? (
                  <div className='flex items-center gap-2' style={muted}>
                    <i className='tabler-loader-2' aria-hidden /> Sending…
                  </div>
                ) : !outcome ? (
                  <Typography variant='body2' style={muted}>
                    Send the request to see the response, timings and check results here.
                  </Typography>
                ) : 'problems' in outcome ? (
                  <Alert variant='warning' title='Not sent'>
                    {outcome.problems.join(' ')}
                  </Alert>
                ) : (
                  <ResponseView
                    out={outcome}
                    onSuggest={
                      outcome.response
                        ? () => {
                            const existing = new Set(req.assertions.map(a => `${a.source}|${a.path ?? ''}|${a.op}`))
                            const add = suggestAssertions(outcome.response!).filter(a => !existing.has(`${a.source}|${a.path ?? ''}|${a.op}`) && !(a.source === 'status' && req.assertions.some(x => x.source === 'status')))

                            patchRequest(req.id, { assertions: [...req.assertions, ...add] })
                            setTab('checks')
                            toast.success(add.length ? `Added ${add.length} check${add.length === 1 ? '' : 's'}` : 'Nothing new to add')
                          }
                        : undefined
                    }
                  />
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <div className='flex justify-end'>
        <Button size='sm' variant='ghost' icon={<i className='tabler-trash' />} onClick={() => setDialog('delete')}>
          Delete collection
        </Button>
      </div>

      {dialog === 'settings' && (
        <CollectionSettingsDialog
          name={d.name}
          description={d.description}
          variables={d.variables}
          auth={d.auth}
          runtime={runtime}
          onApply={p => update(p)}
          onClearRuntime={() => setRuntime({})}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'envs' && o && <EnvironmentsDialog accountId={accountId} environments={environments} max={o.maxEnvironments} initial={envId} onClose={() => setDialog(null)} />}
      {dialog === 'code' && req && o && <SnippetDialog accountId={accountId} request={req} context={{ collectionId, collection: { variables: d.variables, auth: d.auth }, environmentId: envId, runtime }} languages={o.snippetLanguages} onClose={() => setDialog(null)} />}
      {dialog === 'run' && <RunDialog accountId={accountId} collectionId={collectionId} folders={d.folders} environmentId={envId} environments={environments} runtime={runtime} dirty={dirty} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportIntoDialog accountId={accountId} onAdd={addParsed} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog accountId={accountId} collectionId={collectionId} environments={environments} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <DeleteDialog
          name={d.name}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await apiClientService.removeCollection(accountId, collectionId)
              qc.invalidateQueries({ queryKey: apiClientKeys.overview(accountId) })
              setDraft(null)
              toast.success('Collection deleted')
              router.push(`/organizations/${accountId}/api-client`)
            } catch (e) {
              toast.danger((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}

const count = (rows: Array<{ enabled: boolean; key: string }>) => {
  const n = rows.filter(r => r.enabled && r.key).length

  return n ? ` (${n})` : ''
}

function TreeList({
  nodes,
  selected,
  collapsed,
  outcomes,
  onSelect,
  onToggle,
  onRenameFolder,
  onRemoveFolder,
  onAddInFolder,
  onAddSubfolder
}: {
  nodes: TreeNode[]
  selected: string | null
  collapsed: Set<string>
  outcomes: Record<string, Outcome>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
  onRemoveFolder: (id: string) => void
  onAddInFolder: (id: string) => void
  onAddSubfolder: (id: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  // A folder's actions show while its row is hovered, focused or was just tapped, so the name keeps its room.
  const [active, setActive] = useState<string | null>(null)

  return (
    <>
      {nodes.map(n => {
        if (n.kind === 'request') {
          const r = n.request
          const out = outcomes[r.id]
          const status = out && 'response' in out ? out.response?.status : undefined
          const failing = out && 'assertions' in out && out.assertions.some(a => !a.pass)

          return (
            <button
              key={r.id}
              type='button'
              onClick={() => onSelect(r.id)}
              aria-current={r.id === selected ? 'true' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', paddingInlineStart: 8 + n.depth * 14, borderRadius: 8, border: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit', background: r.id === selected ? 'var(--vhyx-color-bg-muted)' : 'transparent' }}
            >
              <span style={{ ...mono, fontSize: 11, fontWeight: 700, minInlineSize: 44, color: `var(--vhyx-color-${METHOD_VARIANT[r.method] === 'outline' || METHOD_VARIANT[r.method] === 'default' ? 'text-muted' : METHOD_VARIANT[r.method]})` }}>{r.method}</span>
              <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{r.name}</span>
              {status !== undefined && (
                <Badge size='sm' variant={failing ? 'danger' : statusVariant(status)}>
                  {failing ? '✗' : status}
                </Badge>
              )}
            </button>
          )
        }

        const f = n.folder
        const open = !collapsed.has(f.id)

        return (
          <div key={f.id} className='flex flex-col'>
            <div
              className='flex items-center gap-1'
              style={{ paddingInlineStart: 4 + n.depth * 14 }}
              onMouseEnter={() => setActive(f.id)}
              onMouseLeave={() => setActive(a => (a === f.id ? null : a))}
              onFocus={() => setActive(f.id)}
            >
              <button type='button' onClick={() => onToggle(f.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${f.name}`} style={{ background: 'none', border: 0, padding: 4, cursor: 'pointer', color: 'inherit' }}>
                <i className={open ? 'tabler-chevron-down' : 'tabler-chevron-right'} aria-hidden />
              </button>
              <i className='tabler-folder' aria-hidden style={muted} />
              {editing === f.id ? (
                <input
                  autoFocus
                  aria-label='Folder name'
                  defaultValue={f.name}
                  maxLength={80}
                  onBlur={e => {
                    onRenameFolder(f.id, e.target.value.trim() || f.name)
                    setEditing(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  style={{ flex: 1, minInlineSize: 0, font: 'inherit', fontSize: 14, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--vhyx-color-border)', background: 'transparent', color: 'inherit' }}
                />
              ) : (
                <button
                  type='button'
                  onDoubleClick={() => setEditing(f.id)}
                  onClick={() => {
                    setActive(f.id)
                    onToggle(f.id)
                  }}
                  style={{ flex: 1, minInlineSize: 0, textAlign: 'start', background: 'none', border: 0, padding: '6px 4px', cursor: 'pointer', color: 'inherit', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title='Double-click to rename'>
                  {f.name}
                </button>
              )}
              {active === f.id && editing !== f.id && <FolderMenu onRename={() => setEditing(f.id)} onAdd={() => onAddInFolder(f.id)} onAddFolder={() => onAddSubfolder(f.id)} onRemove={() => onRemoveFolder(f.id)} name={f.name} />}
            </div>
            {open && <TreeList nodes={n.children} selected={selected} collapsed={collapsed} outcomes={outcomes} onSelect={onSelect} onToggle={onToggle} onRenameFolder={onRenameFolder} onRemoveFolder={onRemoveFolder} onAddInFolder={onAddInFolder} onAddSubfolder={onAddSubfolder} />}
          </div>
        )
      })}
    </>
  )
}

function FolderMenu({ name, onRename, onAdd, onAddFolder, onRemove }: { name: string; onRename: () => void; onAdd: () => void; onAddFolder: () => void; onRemove: () => void }) {
  const btn = { background: 'none', border: 0, padding: 4, cursor: 'pointer', color: 'var(--vhyx-color-text-muted)' } as const

  return (
    <span className='flex'>
      <button type='button' style={btn} onClick={onAdd} aria-label={`New request in ${name}`} title='New request here'>
        <i className='tabler-plus' aria-hidden />
      </button>
      <button type='button' style={btn} onClick={onAddFolder} aria-label={`New folder in ${name}`} title='New folder here'>
        <i className='tabler-folder-plus' aria-hidden />
      </button>
      <button type='button' style={btn} onClick={onRename} aria-label={`Rename ${name}`} title='Rename'>
        <i className='tabler-pencil' aria-hidden />
      </button>
      <button type='button' style={btn} onClick={onRemove} aria-label={`Delete folder ${name}`} title='Delete the folder (its requests move up)'>
        <i className='tabler-trash' aria-hidden />
      </button>
    </span>
  )
}

function HistoryList({ accountId, onOpen }: { accountId: string; onOpen: (r: ApiRequest, out: SendOutcome | null) => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: apiClientKeys.history(accountId), queryFn: () => apiClientService.history(accountId) })

  const open = useMutation({
    mutationFn: (id: string) => apiClientService.historyItem(accountId, id),
    onSuccess: h =>
      onOpen(
        h.request,
        h.response || h.error ? { response: h.response, error: h.error ? { code: 'ERROR', message: h.error } : null, assertions: [], captures: [], warnings: [], request: { method: h.method, url: h.url, headers: [] } } : null
      ),
    onError: e => toast.danger((e as Error).message)
  })

  const clear = useMutation({
    mutationFn: () => apiClientService.clearHistory(accountId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: apiClientKeys.history(accountId) })
      toast.success('History cleared')
    }
  })

  if (q.isLoading) return <Skeleton height='8rem' />
  const items = q.data?.items ?? []

  return (
    <div className='flex flex-col gap-2 mbs-2'>
      {items.length === 0 ? (
        <Typography variant='caption' style={{ ...muted, padding: 8 }}>
          Requests you send show up here (only you see yours).
        </Typography>
      ) : (
        <>
          <ul className='flex flex-col' style={{ listStyle: 'none', padding: 0, margin: 0, maxBlockSize: '60vh', overflowY: 'auto' }}>
            {items.map(h => (
              <li key={h.id}>
                <button type='button' onClick={() => open.mutate(h.id)} title='Open as a new request' style={{ inlineSize: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', borderRadius: 8, border: 0, textAlign: 'start', cursor: 'pointer', color: 'inherit', background: 'transparent' }}>
                  <span className='flex items-center gap-2'>
                    <span style={{ ...mono, fontSize: 11, fontWeight: 700 }}>{h.method}</span>
                    {h.status ? (
                      <Badge size='sm' variant={statusVariant(h.status)}>
                        {h.status}
                      </Badge>
                    ) : (
                      <Badge size='sm' variant='danger'>
                        error
                      </Badge>
                    )}
                    <span style={{ ...muted, fontSize: 12 }}>{new Date(h.createdAt).toLocaleTimeString()}</span>
                  </span>
                  <span style={{ ...mono, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxInlineSize: '100%' }}>{h.url}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button size='sm' variant='ghost' onClick={() => clear.mutate()} loading={clear.isPending}>
            Clear my history
          </Button>
        </>
      )}
    </div>
  )
}

function ExportDialog({ accountId, collectionId, environments, onClose }: { accountId: string; collectionId: string; environments: Array<{ id: string; name: string }>; onClose: () => void }) {
  const [format, setFormat] = useState<'vhyxvoid' | 'postman'>('vhyxvoid')
  const [env, setEnv] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(32rem, calc(100vw - 32px))' }}>
          <Dialog.Title>Export</Dialog.Title>
          <div className='flex flex-col gap-3 mbs-3'>
            <SelectField name='format' label='Format' value={format} onValueChange={v => setFormat(v as 'vhyxvoid')} options={[{ value: 'vhyxvoid', label: 'VhyxVoid JSON (for vhyxvoid test in CI)' }, { value: 'postman', label: 'Postman collection v2.1' }]} />
            {format === 'vhyxvoid' && <SelectField name='env' label='Include an environment' value={env} onValueChange={setEnv} options={[{ value: '', label: 'None' }, ...environments.map(e => ({ value: e.id, label: e.name }))]} />}
            <Typography variant='caption' style={muted}>
              {format === 'vhyxvoid' ? 'Secret values are left empty. In CI pass them with --var NAME=… or VHYXVOID_VAR_NAME.' : 'Checks become pm.test scripts where Postman has an equivalent.'}
            </Typography>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              icon={<i className='tabler-download' />}
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const f = await apiClientService.exportFile(accountId, collectionId, format, env || undefined)

                  download(f.blob, f.name)
                  onClose()
                } catch (e) {
                  toast.danger((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Download
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function DeleteDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(28rem, calc(100vw - 32px))' }}>
          <Dialog.Title>Delete {name}?</Dialog.Title>
          <Typography variant='body2' style={{ ...muted, marginBlockStart: 8 }}>
            Its requests and run reports are deleted for everyone in the workspace. Environments stay.
          </Typography>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
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
