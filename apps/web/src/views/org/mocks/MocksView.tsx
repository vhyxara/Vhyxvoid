'use client'

// Mock APIs of a workspace: create one from a template or an OpenAPI file in
// a few seconds, see its public URL, open the editor.

import { useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, Skeleton, Switch, TextareaField, TextField, toast } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { mocksService, type MockSummary, type MocksOverview } from '@/api/infrastructure/services/mocks.service'
import { LABEL_RE, labelFromName } from './mockForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const
export const mockKeys = { overview: (a: string) => ['mocks', a] as const, one: (a: string, id: string) => ['mocks', a, id] as const }

const TEMPLATE_ICON: Record<string, string> = { blank: 'tabler-file', 'rest-crud': 'tabler-database', auth: 'tabler-lock', flaky: 'tabler-bolt' }

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

type Start = { kind: 'template'; key: string; name: string } | { kind: 'openapi' }

export default function MocksView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const { data: o, isLoading, error } = useQuery({ queryKey: mockKeys.overview(accountId), queryFn: () => mocksService.overview(accountId), enabled: ready })
  const [start, setStart] = useState<Start | null>(null)

  const atLimit = !!o && o.mocks.length >= o.maxMocks
  const canCreate = !!o && o.enabled && o.canManage && o.maxMocks > 0 && !atLimit

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Mock APIs'
        description='A working API before the backend exists. Endpoints answer at a public URL with no agent running; start the agent on the same label later and the URL moves to your real server, route by route.'
      />

      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}
      {o && !o.enabled && <Alert variant='info'>Mock APIs are switched off on this platform right now. Saved mocks answer again once they are back.</Alert>}
      {o && o.enabled && o.maxMocks === 0 && (
        <Alert variant='info' title='Not on this plan'>
          <Link href={`/organizations/${accountId}/billing`}>See plans</Link> to create mock APIs.
        </Alert>
      )}
      {o && o.enabled && o.maxMocks > 0 && !o.canManage && <Alert variant='info'>Only owners and admins can create and change mock APIs. You can open them and try requests.</Alert>}

      {isLoading || !o ? (
        <Skeleton height='16rem' />
      ) : (
        <>
          {o.canManage && o.enabled && o.maxMocks > 0 && (
            <section className='flex flex-col gap-3' aria-labelledby='start-heading'>
              <div className='flex items-baseline justify-between gap-3 flex-wrap'>
                <Typography id='start-heading' variant='h6'>
                  Start a mock
                </Typography>
                <Typography variant='caption' style={muted}>
                  {o.mocks.length} of {o.maxMocks} used{atLimit ? ': delete one or upgrade to add more' : ''}
                </Typography>
              </div>
              <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))' }}>
                {o.templates.map(t => (
                  <StartCard key={t.key} icon={TEMPLATE_ICON[t.key] ?? 'tabler-file'} title={t.name} body={t.description} disabled={!canCreate} onClick={() => setStart({ kind: 'template', key: t.key, name: t.name })} />
                ))}
                <StartCard icon='tabler-file-import' title='From OpenAPI' body='Paste or upload an OpenAPI 3 or Swagger 2 file (JSON or YAML). Every operation becomes an endpoint with its example response.' disabled={!canCreate} onClick={() => setStart({ kind: 'openapi' })} />
              </div>
            </section>
          )}

          <section className='flex flex-col gap-3' aria-labelledby='list-heading'>
            <Typography id='list-heading' variant='h6'>
              Your mock APIs
            </Typography>
            {o.mocks.length === 0 ? (
              <Card className='p-8'>
                <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                  <i className='tabler-api' style={{ fontSize: 36, ...muted }} aria-hidden />
                  <Typography variant='h6'>No mock APIs yet</Typography>
                  <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                    Pick a template above. Your frontend, tests and webhooks get a real URL in seconds, with realistic data, errors and delays you control.
                  </Typography>
                </div>
              </Card>
            ) : (
              <div className='flex flex-col gap-3'>
                {o.mocks.map(m => (
                  <MockCard key={m.id} accountId={accountId} m={m} canManage={o.canManage} />
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

function MockCard({ accountId, m, canManage }: { accountId: string; m: MockSummary; canManage: boolean }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => mocksService.save(accountId, m.id, { enabled, expectedVersion: m.version }),
    onSuccess: r => {
      toast.success(r.enabled ? `${r.name} is answering` : `${r.name} is switched off`)
      qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Card className='p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 18rem' }}>
          <div className='flex items-center gap-2 flex-wrap'>
            <Link href={`/organizations/${accountId}/mocks/${m.id}`} style={{ fontWeight: 700, fontSize: 15, color: 'inherit' }}>
              {m.name}
            </Link>
            <Badge size='sm' variant={m.enabled ? 'success' : 'default'}>
              {m.enabled ? 'answering' : 'off'}
            </Badge>
            <Badge size='sm' variant='info'>
              {m.mode === 'ALWAYS' ? 'mock first' : 'when offline'}
            </Badge>
            <Typography variant='caption' style={muted}>
              {m.endpointCount} endpoint{m.endpointCount === 1 ? '' : 's'}
            </Typography>
          </div>
          {m.url && (
            <button type='button' onClick={() => copy(m.url!)} title='Copy URL' style={{ ...mono, textAlign: 'start', background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-accent)', cursor: 'copy', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.url}
            </button>
          )}
          {m.description && (
            <Typography variant='caption' style={muted}>
              {m.description}
            </Typography>
          )}
        </div>
        <div className='flex items-center gap-3'>
          {canManage && <Switch checked={m.enabled} disabled={toggle.isPending} onCheckedChange={(v: boolean) => toggle.mutate(v)} aria-label={`${m.name} answering`} />}
          <Link href={`/organizations/${accountId}/mocks/${m.id}`}>
            <Button size='sm' variant='outline'>
              {canManage ? 'Edit' : 'Open'}
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}

function CreateDialog({ accountId, start, o, onClose }: { accountId: string; start: Start; o: MocksOverview; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const taken = new Set(o.mocks.map(m => m.label))
  const suggested = start.kind === 'template' ? (start.key === 'blank' ? 'api' : start.key === 'rest-crud' ? 'users-api' : start.key === 'auth' ? 'auth-api' : 'chaos') : 'api'
  const free = (base: string) => {
    let l = base

    for (let i = 2; taken.has(l); i++) l = `${base}-${i}`

    return l
  }
  const [name, setName] = useState(start.kind === 'template' && start.key !== 'blank' ? start.name : '')
  const [label, setLabel] = useState(free(suggested))
  const [labelTouched, setLabelTouched] = useState(false)
  const [openapi, setOpenapi] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const labelOk = LABEL_RE.test(label) && !label.includes('--') && !taken.has(label)
  const create = useMutation({
    mutationFn: () =>
      mocksService.create(accountId, {
        name: name.trim() || (start.kind === 'template' ? start.name : 'Imported API'),
        label,
        ...(start.kind === 'template' ? { template: start.key } : { openapi })
      }),
    onSuccess: m => {
      toast.success(`${m.name} is live with ${m.endpointCount} endpoint${m.endpointCount === 1 ? '' : 's'}`)
      qc.invalidateQueries({ queryKey: mockKeys.overview(accountId) })
      router.push(`/organizations/${accountId}/mocks/${m.id}`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  async function readFile(f: File | undefined) {
    if (!f) return
    if (f.size > 5_000_000) return toast.danger('The file is over 5 MB')
    setOpenapi(await f.text())
  }

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{start.kind === 'template' ? `New mock: ${start.name}` : 'New mock from OpenAPI'}</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (labelOk) create.mutate()
            }}
          >
            <TextField
              name='name'
              label='Name'
              placeholder={start.kind === 'template' ? start.name : 'Taken from the document'}
              value={name}
              onChange={e => {
                setName(e.target.value)
                if (!labelTouched && e.target.value.trim()) setLabel(free(labelFromName(e.target.value) || suggested))
              }}
              autoFocus
            />
            <TextField
              name='label'
              label='Label (part of the URL)'
              value={label}
              onChange={e => {
                setLabelTouched(true)
                setLabel(e.target.value.toLowerCase())
              }}
              hint={labelOk ? `The URL is https://<your slug>--${label}.vhyxvoid.com. Use a tunnel’s label to mock part of it.` : undefined}
              error={!label || labelOk ? undefined : taken.has(label) ? 'You already have a mock with this label.' : 'Lowercase letters, digits and single hyphens.'}
            />
            {start.kind === 'openapi' && (
              <>
                <TextareaField name='openapi' label='OpenAPI document' rows={10} value={openapi} onChange={e => setOpenapi(e.target.value)} placeholder={'openapi: 3.0.3\ninfo:\n  title: Pets\npaths:\n  /pets: …'} style={mono} />
                <div className='flex items-center gap-2'>
                  <input ref={file} type='file' accept='.json,.yaml,.yml,application/json,text/yaml' hidden onChange={e => readFile(e.target.files?.[0])} />
                  <Button type='button' size='sm' variant='outline' onClick={() => file.current?.click()}>
                    Upload a file
                  </Button>
                  <Typography variant='caption' style={muted}>
                    JSON or YAML, up to 5 MB.
                  </Typography>
                </div>
              </>
            )}
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={create.isPending} disabled={!labelOk || (start.kind === 'openapi' && openapi.trim().length < 10)}>
                Create mock
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
