'use client'

// API documentation of a workspace: every spec with its latest published
// version and how it is shared; start one blank, from a file or from a mock.

import { useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  SelectField,
  Skeleton,
  TextareaField,
  TextField,
  toast
} from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { mocksService } from '@/api/infrastructure/services/mocks.service'
import { specsService, type SpecSummary, type SpecsOverview } from '@/api/infrastructure/services/specs.service'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

export const specKeys = {
  overview: (a: string) => ['specs', a] as const,
  one: (a: string, id: string) => ['specs', a, id] as const,
  versions: (a: string, id: string) => ['specs', a, id, 'versions'] as const
}

type Start = 'blank' | 'file' | 'mock'

export const VISIBILITY_LABEL = { PRIVATE: 'private', PUBLIC: 'public', PASSWORD: 'password' } as const

export default function SpecsView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const {
    data: o,
    isLoading,
    error
  } = useQuery({
    queryKey: specKeys.overview(accountId),
    queryFn: () => specsService.overview(accountId),
    enabled: ready
  })
  const [start, setStart] = useState<Start | null>(null)
  const atLimit = !!o && o.specs.length >= o.limits.maxSpecs
  const canCreate = !!o && o.enabled && o.limits.maxSpecs > 0 && !atLimit

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='API docs'
        description='Write an OpenAPI spec in a form or in YAML, checked as you type. Publish versions with a breaking-change report, share clean docs with try-it and code samples, and generate the mock and the tests from the same spec.'
      />

      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}
      {o && !o.enabled && (
        <Alert variant='info'>API documentation is switched off on this platform right now. Your specs are kept.</Alert>
      )}
      {o && o.enabled && o.limits.maxSpecs === 0 && (
        <Alert variant='info' title='Not on this plan'>
          <Link href={`/organizations/${accountId}/billing`}>See plans</Link> to write API docs.
        </Alert>
      )}

      {isLoading || !o ? (
        <Skeleton height='16rem' />
      ) : (
        <>
          <section className='flex flex-col gap-3' aria-labelledby='start-heading'>
            <div className='flex items-baseline justify-between gap-3 flex-wrap'>
              <Typography id='start-heading' variant='h6'>
                Start a spec
              </Typography>
              <Typography variant='caption' style={muted}>
                {o.specs.length} of {o.limits.maxSpecs} used{atLimit ? ': delete one or upgrade to add more' : ''}
              </Typography>
            </div>
            <div
              className='grid gap-3'
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))' }}
            >
              <StartCard
                icon='tabler-file-plus'
                title='Blank'
                body='A small working example (users, a schema, bearer auth) to edit into your API.'
                disabled={!canCreate}
                onClick={() => setStart('blank')}
              />
              <StartCard
                icon='tabler-file-import'
                title='Import OpenAPI'
                body='Paste or upload OpenAPI 3 or Swagger 2, JSON or YAML. Swagger 2 is converted to OpenAPI 3.'
                disabled={!canCreate}
                onClick={() => setStart('file')}
              />
              <StartCard
                icon='tabler-api'
                title='From a mock API'
                body='Document a mock you already built: every endpoint with its example responses, and try-it pointed at the mock.'
                disabled={!canCreate}
                onClick={() => setStart('mock')}
              />
            </div>
          </section>

          <section className='flex flex-col gap-3' aria-labelledby='list-heading'>
            <Typography id='list-heading' variant='h6'>
              Your specs
            </Typography>
            {o.specs.length === 0 ? (
              <Card className='p-8'>
                <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                  <i className='tabler-book' style={{ fontSize: 36, ...muted }} aria-hidden />
                  <Typography variant='h6'>No API docs yet</Typography>
                  <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                    One spec gives you docs, a mock and a test collection that agree with each other.
                  </Typography>
                </div>
              </Card>
            ) : (
              <div className='flex flex-col gap-3'>
                {o.specs.map(s => (
                  <SpecCard key={s.id} accountId={accountId} s={s} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {start && o && <CreateDialog accountId={accountId} start={start} o={o} onClose={() => setStart(null)} />}
    </div>
  )
}

function StartCard({
  icon,
  title,
  body,
  disabled,
  onClick
}: {
  icon: string
  title: string
  body: string
  disabled: boolean
  onClick: () => void
}) {
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

function SpecCard({ accountId, s }: { accountId: string; s: SpecSummary }) {
  const href = `/organizations/${accountId}/api-docs/${s.id}`
  const shared = s.visibility !== 'PRIVATE'

  return (
    <Card className='p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 18rem' }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <Link href={href} style={{ fontWeight: 700, fontSize: 15, color: 'inherit' }}>
              {s.name}
            </Link>
            {s.latest ? (
              <Badge size='sm' variant='success'>
                v{s.latest.number}
                {s.latest.version ? ` · ${s.latest.version}` : ''}
              </Badge>
            ) : (
              <Badge size='sm' variant='default'>
                not published
              </Badge>
            )}
            {s.latest && s.unpublished && (
              <Badge size='sm' variant='warning'>
                unpublished changes
              </Badge>
            )}
            <Badge size='sm' variant={shared ? 'info' : 'outline'}>
              {VISIBILITY_LABEL[s.visibility]}
            </Badge>
            {s.latest && s.latest.breaking > 0 && (
              <Badge size='sm' variant='danger'>
                {s.latest.breaking} breaking in v{s.latest.number}
              </Badge>
            )}
          </div>
          {shared && s.latest && (
            <a
              href={s.customDomainUrl ?? s.publicUrl}
              target='_blank'
              rel='noreferrer'
              style={{
                ...mono,
                color: 'var(--vhyx-color-accent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {s.customDomainUrl ?? s.publicUrl}
            </a>
          )}
          {s.description && (
            <Typography variant='caption' style={muted}>
              {s.description}
            </Typography>
          )}
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

function CreateDialog({
  accountId,
  start,
  o,
  onClose
}: {
  accountId: string
  start: Start
  o: SpecsOverview
  onClose: () => void
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const ready = useBootstrapReady()
  const [name, setName] = useState('')
  const [doc, setDoc] = useState('')
  const [mockId, setMockId] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const mocks = useQuery({
    queryKey: ['mocks', accountId],
    queryFn: () => mocksService.overview(accountId),
    enabled: ready && start === 'mock'
  })

  const create = useMutation({
    mutationFn: () =>
      specsService.create(accountId, {
        name:
          name.trim() ||
          (start === 'mock'
            ? (mocks.data?.mocks.find(m => m.id === mockId)?.name ?? 'API')
            : start === 'file'
              ? docTitle(doc) || 'Imported API'
              : 'My API'),
        ...(start === 'file' ? { document: doc } : start === 'mock' ? { mockId } : {})
      }),
    onSuccess: s => {
      toast.success(`${s.name} created`)
      qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
      router.push(`/organizations/${accountId}/api-docs/${s.id}`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  async function readFile(f: File | undefined) {
    if (!f) return
    if (f.size > 5_000_000) return toast.danger('The file is over 5 MB')
    setDoc(await f.text())
  }

  const ok = start === 'blank' ? name.trim().length > 0 : start === 'file' ? doc.trim().length >= 10 : !!mockId

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>
            {start === 'blank'
              ? 'New API spec'
              : start === 'file'
                ? 'Import an OpenAPI document'
                : 'Document a mock API'}
          </Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (ok) create.mutate()
            }}
          >
            <TextField
              name='name'
              label='Name'
              placeholder={start === 'blank' ? 'Payments API' : 'Taken from the source'}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              hint={`Docs are shared at /api-docs/${o.workspace}/<name>.`}
            />
            {start === 'file' && (
              <>
                <TextareaField
                  name='document'
                  label='Document'
                  rows={10}
                  value={doc}
                  onChange={e => setDoc(e.target.value)}
                  placeholder={'openapi: 3.0.3\ninfo:\n  title: Payments\n  version: 1.0.0\npaths: {}'}
                  style={mono}
                />
                <div className='flex items-center gap-2'>
                  <input
                    ref={file}
                    type='file'
                    accept='.json,.yaml,.yml,application/json,text/yaml'
                    hidden
                    onChange={e => readFile(e.target.files?.[0])}
                  />
                  <Button type='button' size='sm' variant='outline' onClick={() => file.current?.click()}>
                    Upload a file
                  </Button>
                  <Typography variant='caption' style={muted}>
                    JSON or YAML, up to 5 MB.
                  </Typography>
                </div>
              </>
            )}
            {start === 'mock' &&
              (mocks.isLoading ? (
                <Skeleton height='2.5rem' />
              ) : (mocks.data?.mocks.length ?? 0) === 0 ? (
                <Alert variant='info'>
                  No mock APIs yet. <Link href={`/organizations/${accountId}/mocks`}>Create one</Link> first.
                </Alert>
              ) : (
                <SelectField
                  name='mock'
                  label='Mock API'
                  value={mockId}
                  onValueChange={setMockId}
                  placeholder='Pick a mock'
                  options={(mocks.data?.mocks ?? []).map(m => ({
                    value: m.id,
                    label: `${m.name} (${m.endpointCount} endpoints)`
                  }))}
                />
              ))}
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
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

/** The title from pasted YAML/JSON, without a parser (good enough for a default name). */
export function docTitle(text: string): string {
  const json = /"title"\s*:\s*"([^"]{1,80})"/.exec(text)

  if (json) return json[1]
  const yaml = /^\s{2}title:\s*['"]?([^'"\n]{1,80})['"]?\s*$/m.exec(text)

  return yaml ? yaml[1].trim() : ''
}
