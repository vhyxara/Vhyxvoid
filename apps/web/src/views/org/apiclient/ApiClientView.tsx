'use client'

// The API client's home: collections of a workspace (start blank, import
// curl / Postman / OpenAPI / HAR, or generate tests for a mock API), the
// shared environments, and how to run a collection from CI.

import { useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, TextareaField, TextField, toast } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { apiClientService, type ApiClientOverview, type CollectionSummary } from '@/api/infrastructure/services/apiClient.service'
import { mocksService } from '@/api/infrastructure/services/mocks.service'
import { EnvironmentsDialog } from './ApiClientParts'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

export const apiClientKeys = {
  overview: (a: string) => ['api-client', a] as const,
  collection: (a: string, id: string) => ['api-client', a, 'collection', id] as const,
  runs: (a: string, id: string) => ['api-client', a, 'runs', id] as const,
  history: (a: string) => ['api-client', a, 'history'] as const
}

type Start = 'blank' | 'import' | 'mock'

export default function ApiClientView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const { data: o, isLoading, error } = useQuery({ queryKey: apiClientKeys.overview(accountId), queryFn: () => apiClientService.overview(accountId), enabled: ready })
  const [start, setStart] = useState<Start | null>(null)
  const [envs, setEnvs] = useState(false)

  const atLimit = !!o && o.collections.length >= o.maxCollections
  const canCreate = !!o && o.enabled && o.maxCollections > 0 && !atLimit

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='API client'
        description='Send requests from the browser without CORS trouble, keep them in collections your team shares, add checks without writing code, and run the whole collection here or in CI.'
      />

      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}
      {o && !o.enabled && <Alert variant='info'>The API client is switched off on this platform right now. Your collections are kept.</Alert>}
      {o && o.enabled && o.maxCollections === 0 && (
        <Alert variant='info' title='Not on this plan'>
          <Link href={`/organizations/${accountId}/billing`}>See plans</Link> to use the API client.
        </Alert>
      )}

      {isLoading || !o ? (
        <Skeleton height='16rem' />
      ) : (
        <>
          {o.enabled && o.maxCollections > 0 && (
            <section className='flex flex-col gap-3' aria-labelledby='start-heading'>
              <div className='flex items-baseline justify-between gap-3 flex-wrap'>
                <Typography id='start-heading' variant='h6'>
                  New collection
                </Typography>
                <Typography variant='caption' style={muted}>
                  {o.collections.length} of {o.maxCollections} used{atLimit ? ': delete one or upgrade to add more' : ''} · {o.sendsPerMinute} sends a minute
                </Typography>
              </div>
              <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))' }}>
                <StartCard icon='tabler-file-plus' title='Blank' body='An empty collection with a baseUrl variable. Add requests, folders and checks.' disabled={!canCreate} onClick={() => setStart('blank')} />
                <StartCard icon='tabler-file-import' title='Import' body='Paste a curl command, or a Postman collection, OpenAPI / Swagger (JSON or YAML), a HAR recording or a VhyxVoid export.' disabled={!canCreate} onClick={() => setStart('import')} />
                <StartCard icon='tabler-api' title='Test a mock API' body='One request per endpoint with status checks, and create → read → delete flows for resources.' disabled={!canCreate} onClick={() => setStart('mock')} />
              </div>
            </section>
          )}

          <section className='flex flex-col gap-3' aria-labelledby='list-heading'>
            <div className='flex items-center justify-between gap-3 flex-wrap'>
              <Typography id='list-heading' variant='h6'>
                Collections
              </Typography>
              <Button size='sm' variant='outline' icon={<i className='tabler-variable' />} onClick={() => setEnvs(true)} disabled={!o.enabled}>
                Environments ({o.environments.length})
              </Button>
            </div>
            {o.collections.length === 0 ? (
              <Card className='p-8'>
                <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                  <i className='tabler-send' style={{ fontSize: 36, ...muted }} aria-hidden />
                  <Typography variant='h6'>No collections yet</Typography>
                  <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                    Start blank, or paste a curl command from your browser&apos;s dev tools: it becomes a request you can send, check and share.
                  </Typography>
                </div>
              </Card>
            ) : (
              <div className='flex flex-col gap-3'>
                {o.collections.map(c => (
                  <CollectionCard key={c.id} accountId={accountId} c={c} />
                ))}
              </div>
            )}
          </section>

          <Card className='p-4'>
            <div className='flex flex-col gap-2'>
              <Typography variant='subtitle1' style={{ fontWeight: 600 }}>
                Run in CI
              </Typography>
              <Typography variant='body2' style={muted}>
                Export a collection (VhyxVoid JSON) and run it with the agent. It exits with 1 when a check fails and can write a JUnit report. Requests go from the CI machine, so localhost works.
              </Typography>
              <pre style={{ ...mono, margin: 0, padding: 12, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', overflowX: 'auto' }}>
                {`npx -y @vhyxvoid/agent test ./shop.vhyxvoid.json --env Staging \\\n  --var token=$API_TOKEN --junit report.xml`}
              </pre>
            </div>
          </Card>
        </>
      )}

      {start && o && <CreateDialog accountId={accountId} start={start} onClose={() => setStart(null)} />}
      {envs && o && <EnvironmentsDialog accountId={accountId} environments={o.environments} max={o.maxEnvironments} onClose={() => setEnvs(false)} />}
    </div>
  )
}

function StartCard({ icon, title, body, disabled, onClick }: { icon: string; title: string; body: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'start',
        padding: 16,
        borderRadius: 12,
        border: '1px solid var(--vhyx-color-border)',
        background: 'var(--vhyx-color-bg-elevated, var(--vhyx-color-bg))',
        color: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <span className='flex items-center gap-2' style={{ fontWeight: 600 }}>
        <i className={icon} aria-hidden style={{ fontSize: 18, color: 'var(--vhyx-color-accent)' }} />
        {title}
      </span>
      <span style={{ ...muted, fontSize: 13, lineHeight: 1.45 }}>{body}</span>
    </button>
  )
}

function CollectionCard({ accountId, c }: { accountId: string; c: CollectionSummary }) {
  const href = `/organizations/${accountId}/api-client/${c.id}`

  return (
    <Card className='p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 18rem' }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <Link href={href} style={{ fontWeight: 700, fontSize: 15, color: 'inherit' }}>
              {c.name}
            </Link>
            <Badge size='sm' variant='outline'>
              {c.requestCount} request{c.requestCount === 1 ? '' : 's'}
            </Badge>
            {c.folderCount > 0 && (
              <Typography variant='caption' style={muted}>
                {c.folderCount} folder{c.folderCount === 1 ? '' : 's'}
              </Typography>
            )}
          </div>
          {c.description && (
            <Typography variant='caption' style={{ ...muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.description}
            </Typography>
          )}
          <Typography variant='caption' style={muted}>
            Changed {new Date(c.updatedAt).toLocaleString()}
          </Typography>
        </div>
        <Link href={href}>
          <Button size='sm' variant='outline'>
            Open
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function CreateDialog({ accountId, start, onClose }: { accountId: string; start: Start; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(start === 'blank' ? 'My API' : '')
  const [doc, setDoc] = useState('')
  const [mockId, setMockId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const mocks = useQuery({ queryKey: ['mocks', accountId], queryFn: () => mocksService.overview(accountId), enabled: start === 'mock' })

  const create = useMutation({
    mutationFn: () => apiClientService.createCollection(accountId, start === 'blank' ? { name: name.trim() } : start === 'import' ? { document: doc, ...(name.trim() ? { name: name.trim() } : {}) } : { mockId, ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: c => {
      if (c.warnings?.length) toast.warning(`${c.warnings.length} note${c.warnings.length === 1 ? '' : 's'} from the import: ${c.warnings.slice(0, 2).join('; ')}`)
      if (c.environmentsCreated?.length) toast.success(`Environments added: ${c.environmentsCreated.join(', ')}`)
      router.push(`/organizations/${accountId}/api-client/${c.id}`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  const ok = start === 'blank' ? !!name.trim() : start === 'import' ? doc.trim().length > 1 : !!mockId

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(40rem, calc(100vw - 32px))' }}>
          <Dialog.Title>{start === 'blank' ? 'New collection' : start === 'import' ? 'Import a collection' : 'Test a mock API'}</Dialog.Title>
          <form
            className='flex flex-col gap-3 mbs-3'
            onSubmit={e => {
              e.preventDefault()
              if (ok) create.mutate()
            }}
          >
            <TextField name='name' label={start === 'blank' ? 'Name' : 'Name (optional: taken from the document)'} value={name} onChange={e => setName(e.target.value)} maxLength={80} />
            {start === 'import' && (
              <>
                <TextareaField name='document' label='curl command or document' rows={10} value={doc} onChange={e => setDoc(e.target.value)} placeholder={`curl https://api.example.com/v1/users -H 'Authorization: Bearer …'\n\nor paste Postman / OpenAPI / HAR JSON, or OpenAPI YAML`} style={mono} />
                <div className='flex items-center gap-2'>
                  <input
                    ref={fileRef}
                    type='file'
                    accept='.json,.yaml,.yml,.har,application/json'
                    hidden
                    onChange={async e => {
                      const f = e.target.files?.[0]

                      if (!f) return
                      if (f.size > 10_000_000) return toast.danger('The file is larger than 10 MB')
                      setDoc(await f.text())
                    }}
                  />
                  <Button type='button' size='sm' variant='outline' icon={<i className='tabler-upload' />} onClick={() => fileRef.current?.click()}>
                    Choose a file
                  </Button>
                  <Typography variant='caption' style={muted}>
                    Postman v2.x, OpenAPI 3 / Swagger 2, HAR, VhyxVoid
                  </Typography>
                </div>
              </>
            )}
            {start === 'mock' &&
              (mocks.isLoading ? (
                <Skeleton height='3rem' />
              ) : (mocks.data?.mocks.length ?? 0) === 0 ? (
                <Alert variant='info'>
                  This workspace has no mock APIs yet. <Link href={`/organizations/${accountId}/mocks`}>Create one</Link>.
                </Alert>
              ) : (
                <SelectField name='mock' label='Mock API' value={mockId} onValueChange={setMockId} options={(mocks.data?.mocks ?? []).map(m => ({ value: m.id, label: `${m.name} (${m.endpointCount} endpoints)` }))} />
              ))}
            <Dialog.Footer>
              <Button type='button' variant='secondary' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={create.isPending} disabled={!ok}>
                Create
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export type { ApiClientOverview }
