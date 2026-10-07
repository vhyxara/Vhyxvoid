'use client'

// One API spec: edit it as YAML/JSON (checked as you type) or in a form, see
// the rendered docs with try-it, publish versions with the changes since the
// last one, and share them. The same spec makes a mock API and a test
// collection in one click.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Input,
  SelectField,
  Skeleton,
  Tabs,
  TextareaField,
  TextField,
  toast
} from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import SpecDocsView, { MethodBadge, type TryHandler } from '@/components/apidocs/SpecDocsView'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { apiClientService, type ApiMethod } from '@/api/infrastructure/services/apiClient.service'
import { mocksService } from '@/api/infrastructure/services/mocks.service'
import {
  specsService,
  type Spec,
  type SpecChange,
  type SpecPreview,
  type SpecProblem,
  type Visibility
} from '@/api/infrastructure/services/specs.service'
import { newRequest } from '@/views/org/apiclient/apiClientForm'
import { LABEL_RE, labelFromName } from '@/views/org/mocks/mockForm'
import { specKeys, VISIBILITY_LABEL } from './SpecsView'
import {
  SLUG_RE,
  SPEC_METHODS,
  addOperation,
  formParams,
  joinUrl,
  listOperations,
  pathProblem,
  problemLine,
  removeOperation,
  setInfo,
  setParams,
  setResponses,
  setServers,
  severityVariant,
  updateOperation,
  type FormParam,
  type OperationRef,
  type SpecMethod
} from './specForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono: CSSProperties = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 }
const TABS = ['editor', 'form', 'preview', 'versions', 'sharing'] as const

// An OpenAPI document is free-form JSON; the server validates it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function SpecWorkspaceView({ accountId, specId }: { accountId: string; specId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('tab')
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as (typeof TABS)[number]) : 'editor'
  const setTab = (t: string) => router.replace(`?tab=${t}`, { scroll: false })

  const {
    data: spec,
    isLoading,
    error
  } = useQuery({
    queryKey: specKeys.one(accountId, specId),
    queryFn: () => specsService.get(accountId, specId),
    enabled: ready
  })

  // The text being edited; null = same as saved.
  const [text, setText] = useState<string | null>(null)
  const current = text ?? spec?.draftText ?? ''
  const dirty = text !== null && text !== spec?.draftText
  const [preview, setPreview] = useState<SpecPreview | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [generate, setGenerate] = useState<'mock' | 'collection' | null>(null)

  // Check the text as it changes (debounced); the server parses YAML, so the browser needs no parser.
  useEffect(() => {
    if (!spec) return
    const t = setTimeout(() => {
      specsService.preview(accountId, specId, current).then(setPreview, () => undefined)
    }, 500)

    return () => clearTimeout(t)
  }, [accountId, specId, current, spec])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()

    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useMutation({
    mutationFn: (data: { text?: string; doc?: Json }) =>
      specsService.save(accountId, specId, { ...data, expectedVersion: spec?.version }),
    onSuccess: s => {
      qc.setQueryData(specKeys.one(accountId, specId), (prev: Spec | undefined) => ({ ...(prev ?? {}), ...s }) as Spec)
      qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
      setText(null)
      toast.success('Saved')
    },
    onError: e => toast.danger((e as Error).message)
  })

  const saveText = useCallback(() => {
    if (dirty && !save.isPending) save.mutate({ text: current })
  }, [dirty, save, current])

  const problems = preview?.problems ?? spec?.problems ?? []
  const errors = problems.filter(p => p.severity === 'error')

  if (isLoading || !spec)
    return error ? <Alert variant='danger'>{(error as Error).message}</Alert> : <Skeleton height='24rem' />

  const shared = spec.visibility !== 'PRIVATE'
  const liveUrl = spec.customDomainUrl ?? spec.publicUrl

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: '1 1 20rem' }}>
          <Link href={`/organizations/${accountId}/api-docs`} style={{ ...muted, fontSize: 13 }}>
            ← API docs
          </Link>
          <div className='flex items-center gap-2 flex-wrap'>
            <Typography variant='h5' style={{ margin: 0 }}>
              {spec.name}
            </Typography>
            {spec.latest ? (
              <Badge variant='success'>v{spec.latest.number} published</Badge>
            ) : (
              <Badge variant='default'>not published</Badge>
            )}
            {(dirty || spec.unpublished) && (
              <Badge variant='warning'>{dirty ? 'unsaved' : 'unpublished changes'}</Badge>
            )}
            <Badge variant={shared ? 'info' : 'outline'}>{VISIBILITY_LABEL[spec.visibility]}</Badge>
          </div>
          {shared && spec.latest && (
            <a
              href={liveUrl}
              target='_blank'
              rel='noreferrer'
              style={{ ...mono, color: 'var(--vhyx-color-accent)', wordBreak: 'break-all' }}
            >
              {liveUrl}
            </a>
          )}
        </div>
        <div className='flex items-center gap-2 flex-wrap'>
          <Button variant='outline' size='sm' onClick={() => setGenerate('mock')} icon={<i className='tabler-api' />}>
            Make a mock
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setGenerate('collection')}
            icon={<i className='tabler-checklist' />}
          >
            Make tests
          </Button>
          {dirty && (
            <Button size='sm' variant='secondary' onClick={saveText} loading={save.isPending}>
              Save
            </Button>
          )}
          <Button
            size='sm'
            onClick={() => setPublishing(true)}
            disabled={dirty || errors.length > 0 || !spec.unpublished || spec.enabledOnPlatform === false}
            title={
              dirty
                ? 'Save first'
                : errors.length
                  ? 'Fix the errors first'
                  : !spec.unpublished
                    ? 'Nothing changed since the last version'
                    : undefined
            }
          >
            Publish…
          </Button>
        </div>
      </div>

      {spec.enabledOnPlatform === false && (
        <Alert variant='info'>
          API documentation is switched off on this platform right now: you can read your specs but not change or
          publish them.
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab} variant='underline'>
        <Tabs.List style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
          <Tabs.Trigger value='editor'>Editor{errors.length ? ` (${errors.length})` : ''}</Tabs.Trigger>
          <Tabs.Trigger value='form'>Form</Tabs.Trigger>
          <Tabs.Trigger value='preview'>Preview</Tabs.Trigger>
          <Tabs.Trigger value='versions'>Versions</Tabs.Trigger>
          <Tabs.Trigger value='sharing'>Sharing</Tabs.Trigger>
        </Tabs.List>
        <div className='mbs-4'>
          <Tabs.Content value='editor'>
            <EditorTab
              text={current}
              onChange={setText}
              problems={problems}
              onSave={saveText}
              converted={preview?.converted ?? false}
              format={spec.draftFormat}
            />
          </Tabs.Content>
          <Tabs.Content value='form'>
            {dirty ? (
              <Alert variant='info'>
                Save the text first: the form edits the saved spec.{' '}
                <Button size='sm' variant='link' onClick={saveText}>
                  Save now
                </Button>
              </Alert>
            ) : preview?.doc ? (
              <FormTab doc={preview.doc} saving={save.isPending} onSave={doc => save.mutate({ doc })} />
            ) : (
              <Alert variant='warning'>The text doesn’t parse yet. Fix it in the editor, then the form opens.</Alert>
            )}
          </Tabs.Content>
          <Tabs.Content value='preview'>
            {preview?.model ? (
              <PreviewTab accountId={accountId} model={preview.model} />
            ) : (
              <Alert variant='warning'>Nothing to show until the text parses.</Alert>
            )}
          </Tabs.Content>
          <Tabs.Content value='versions'>
            <VersionsTab
              accountId={accountId}
              spec={spec}
              draftChanges={preview?.changes ?? []}
              onRestored={() => setText(null)}
            />
          </Tabs.Content>
          <Tabs.Content value='sharing'>
            <SharingTab accountId={accountId} spec={spec} />
          </Tabs.Content>
        </div>
      </Tabs>

      {publishing && (
        <PublishDialog accountId={accountId} spec={spec} preview={preview} onClose={() => setPublishing(false)} />
      )}
      {generate && (
        <GenerateDialog
          accountId={accountId}
          spec={spec}
          text={current}
          kind={generate}
          onClose={() => setGenerate(null)}
        />
      )}
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────

function EditorTab({
  text,
  onChange,
  problems,
  onSave,
  converted,
  format
}: {
  text: string
  onChange: (t: string) => void
  problems: SpecProblem[]
  onSave: () => void
  converted: boolean
  format: string
}) {
  const area = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const lineCount = useMemo(() => text.split('\n').length, [text])
  const errors = problems.filter(p => p.severity === 'error')
  const warnings = problems.filter(p => p.severity === 'warning')

  function goTo(line: number) {
    const el = area.current

    if (!el) return
    const lines = text.split('\n')
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)

    el.focus()
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
    el.scrollTop = Math.max(0, (line - 4) * 20)
  }

  return (
    <div
      className='grid gap-4'
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))', alignItems: 'start' }}
    >
      <div
        style={{
          display: 'flex',
          border: '1px solid var(--vhyx-color-border)',
          borderRadius: 10,
          overflow: 'hidden',
          blockSize: 'min(70vh, 720px)',
          background: 'var(--vhyx-color-bg-muted)',
          gridColumn: 'span 1',
          minInlineSize: 0
        }}
      >
        <div
          ref={gutter}
          aria-hidden
          style={{
            ...mono,
            lineHeight: '20px',
            padding: '10px 8px',
            textAlign: 'end',
            color: 'var(--vhyx-color-text-subtle)',
            userSelect: 'none',
            overflow: 'hidden',
            minInlineSize: 44,
            borderInlineEnd: '1px solid var(--vhyx-color-border)'
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={area}
          value={text}
          onChange={e => onChange(e.target.value)}
          onScroll={e => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
          }}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault()
              onSave()
            }

            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              const el = e.currentTarget
              const s = el.selectionStart

              onChange(`${text.slice(0, s)}  ${text.slice(el.selectionEnd)}`)
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
            }
          }}
          spellCheck={false}
          aria-label={`Spec (${format.toUpperCase()})`}
          wrap='off'
          style={{
            ...mono,
            lineHeight: '20px',
            padding: 10,
            border: 0,
            outline: 'none',
            resize: 'none',
            flex: 1,
            minInlineSize: 0,
            background: 'transparent',
            color: 'inherit',
            tabSize: 2
          }}
        />
      </div>
      <div className='flex flex-col gap-3' style={{ minInlineSize: 0 }}>
        <Typography variant='caption' style={muted}>
          {format.toUpperCase()} · OpenAPI 3.0/3.1 or Swagger 2 · Ctrl/⌘ + S saves. Drafts save even with errors;
          publishing needs none.
        </Typography>
        {converted && (
          <Alert variant='info'>
            This is Swagger 2. The docs show it converted to OpenAPI 3.0.3; publishing stores the converted version.
          </Alert>
        )}
        {problems.length === 0 ? (
          <Alert variant='success'>No problems found.</Alert>
        ) : (
          <div className='flex flex-col gap-2'>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning
              {warnings.length === 1 ? '' : 's'}
            </span>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxBlockSize: 'min(62vh, 640px)',
                overflow: 'auto'
              }}
            >
              {[...errors, ...warnings].map((p, i) => {
                const line = problemLine(text, p.path)

                return (
                  <li key={`${i}-${p.path}`}>
                    <button
                      type='button'
                      onClick={() => line && goTo(line)}
                      disabled={!line}
                      style={{
                        textAlign: 'start',
                        inlineSize: '100%',
                        background: 'none',
                        border: '1px solid var(--vhyx-color-border)',
                        borderRadius: 8,
                        padding: '6px 10px',
                        color: 'inherit',
                        cursor: line ? 'pointer' : 'default'
                      }}
                    >
                      <span className='flex items-center gap-2 flex-wrap'>
                        <Badge size='sm' variant={severityVariant(p.severity)}>
                          {p.severity}
                        </Badge>
                        {line && <span style={{ ...muted, fontSize: 12 }}>line {line}</span>}
                        {p.path && !p.path.startsWith('line ') && (
                          <code style={{ ...mono, fontSize: 12, ...muted, wordBreak: 'break-all' }}>{p.path}</code>
                        )}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, marginTop: 2 }}>{p.message}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form ──────────────────────────────────────────────────────────────────

function FormTab({ doc: saved, saving, onSave }: { doc: Json; saving: boolean; onSave: (doc: Json) => void }) {
  const [doc, setDoc] = useState<Json>(saved)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState({ method: 'get' as SpecMethod, path: '/' })
  const changed = JSON.stringify(doc) !== JSON.stringify(saved)

  useEffect(() => setDoc(saved), [saved])

  const ops = listOperations(doc)
  const addErr =
    pathProblem(adding.path) ??
    (ops.some(o => o.path === adding.path && o.method === adding.method) ? 'That operation exists' : null)
  const apply = (fn: (d: Json) => Json) => {
    try {
      setDoc(fn(doc))
    } catch (e) {
      toast.danger((e as Error).message)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <Typography variant='caption' style={muted}>
          The form writes back to the spec’s text. Schemas, examples and anything else stay as they are; edit those in
          the editor.
        </Typography>
        <div className='flex gap-2'>
          <Button size='sm' variant='secondary' disabled={!changed} onClick={() => setDoc(saved)}>
            Discard
          </Button>
          <Button size='sm' disabled={!changed} loading={saving} onClick={() => onSave(doc)}>
            Save form changes
          </Button>
        </div>
      </div>

      <Card className='p-4'>
        <div className='flex flex-col gap-3'>
          <Typography variant='subtitle2'>About the API</Typography>
          <div
            className='grid gap-3'
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))' }}
          >
            <TextField
              name='title'
              label='Title'
              value={String(doc.info?.title ?? '')}
              onChange={e =>
                apply(d =>
                  setInfo(d, {
                    title: e.target.value,
                    version: String(d.info?.version ?? ''),
                    description: String(d.info?.description ?? '')
                  })
                )
              }
            />
            <TextField
              name='version'
              label='Version'
              value={String(doc.info?.version ?? '')}
              onChange={e =>
                apply(d =>
                  setInfo(d, {
                    title: String(d.info?.title ?? ''),
                    version: e.target.value,
                    description: String(d.info?.description ?? '')
                  })
                )
              }
            />
          </div>
          <TextareaField
            name='description'
            label='Description (Markdown)'
            rows={3}
            value={String(doc.info?.description ?? '')}
            onChange={e =>
              apply(d =>
                setInfo(d, {
                  title: String(d.info?.title ?? ''),
                  version: String(d.info?.version ?? ''),
                  description: e.target.value
                })
              )
            }
          />
          <ServersEditor
            servers={Array.isArray(doc.servers) ? doc.servers : []}
            onChange={list => apply(d => setServers(d, list))}
          />
        </div>
      </Card>

      <Card className='p-4'>
        <div className='flex flex-col gap-3'>
          <Typography variant='subtitle2'>Operations ({ops.length})</Typography>
          <form
            className='flex flex-wrap items-end gap-2'
            onSubmit={e => {
              e.preventDefault()
              if (addErr) return
              apply(d => addOperation(d, adding))
              setOpen(`${adding.method} ${adding.path}`)
            }}
          >
            <div style={{ inlineSize: '8rem' }}>
              <SelectField
                name='method'
                label='Method'
                size='sm'
                value={adding.method}
                onValueChange={v => setAdding(a => ({ ...a, method: v as SpecMethod }))}
                options={SPEC_METHODS.map(m => ({ value: m, label: m.toUpperCase() }))}
              />
            </div>
            <div style={{ flex: '1 1 14rem' }}>
              <TextField
                name='path'
                label='Path'
                size='sm'
                value={adding.path}
                onChange={e => setAdding(a => ({ ...a, path: e.target.value }))}
                error={adding.path !== '/' && addErr ? addErr : undefined}
                placeholder='/users/{id}'
              />
            </div>
            <Button size='sm' type='submit' disabled={!!addErr}>
              Add operation
            </Button>
          </form>
          <div className='flex flex-col gap-2'>
            {ops.map(o => {
              const key = `${o.method} ${o.path}`

              return (
                <div key={key} style={{ border: '1px solid var(--vhyx-color-border)', borderRadius: 10 }}>
                  <button
                    type='button'
                    onClick={() => setOpen(open === key ? null : key)}
                    aria-expanded={open === key}
                    className='flex items-center gap-2'
                    style={{
                      inlineSize: '100%',
                      background: 'none',
                      border: 0,
                      padding: '8px 12px',
                      color: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'start'
                    }}
                  >
                    <MethodBadge method={o.method} small />
                    <code style={{ ...mono, wordBreak: 'break-all' }}>{o.path}</code>
                    <span
                      style={{
                        ...muted,
                        fontSize: 13,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {o.summary}
                    </span>
                    <i
                      className={open === key ? 'tabler-chevron-up' : 'tabler-chevron-down'}
                      style={{ marginInlineStart: 'auto' }}
                      aria-hidden
                    />
                  </button>
                  {open === key && (
                    <OperationForm
                      doc={doc}
                      op={{ path: o.path, method: o.method }}
                      apply={apply}
                      onRemove={() => apply(d => removeOperation(d, { path: o.path, method: o.method }))}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Card>
    </div>
  )
}

function ServersEditor({
  servers,
  onChange
}: {
  servers: Array<{ url?: string; description?: string }>
  onChange: (s: Array<{ url: string; description: string }>) => void
}) {
  const rows = servers.map(s => ({ url: String(s.url ?? ''), description: String(s.description ?? '') }))
  const set = (i: number, patch: Partial<{ url: string; description: string }>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className='flex flex-col gap-2'>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Servers</span>
      {rows.map((r, i) => (
        <div key={i} className='flex gap-2 flex-wrap items-center'>
          <div style={{ flex: '2 1 14rem' }}>
            <Input
              size='sm'
              value={r.url}
              onChange={e => set(i, { url: e.target.value })}
              placeholder='https://api.example.com/v1'
              aria-label={`Server ${i + 1} URL`}
            />
          </div>
          <div style={{ flex: '1 1 10rem' }}>
            <Input
              size='sm'
              value={r.description}
              onChange={e => set(i, { description: e.target.value })}
              placeholder='Production'
              aria-label={`Server ${i + 1} description`}
            />
          </div>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label='Remove server'
          >
            <i className='tabler-trash' aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button size='sm' variant='outline' onClick={() => onChange([...rows, { url: 'https://', description: '' }])}>
          Add server
        </Button>
      </div>
    </div>
  )
}

function OperationForm({
  doc,
  op,
  apply,
  onRemove
}: {
  doc: Json
  op: OperationRef
  apply: (fn: (d: Json) => Json) => void
  onRemove: () => void
}) {
  const o = doc.paths?.[op.path]?.[op.method] ?? {}
  const params = formParams(doc, op)
  const responses = Object.entries(o.responses ?? {}).map(([code, r]) => ({
    code,
    description: String((r as Json)?.description ?? '')
  }))
  const setP = (rows: FormParam[]) => apply(d => setParams(d, op, rows))
  const setR = (rows: Array<{ code: string; description: string }>) => apply(d => setResponses(d, op, rows))

  return (
    <div className='flex flex-col gap-3' style={{ padding: '4px 12px 12px' }}>
      <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))' }}>
        <TextField
          name='summary'
          label='Summary'
          size='sm'
          value={String(o.summary ?? '')}
          onChange={e => apply(d => updateOperation(d, op, { summary: e.target.value }))}
        />
        <TextField
          name='operationId'
          label='operationId'
          size='sm'
          value={String(o.operationId ?? '')}
          onChange={e => apply(d => updateOperation(d, op, { operationId: e.target.value }))}
        />
        <TextField
          name='tags'
          label='Tags (comma-separated)'
          size='sm'
          value={(o.tags ?? []).join(', ')}
          onChange={e =>
            apply(d =>
              updateOperation(d, op, {
                tags: e.target.value
                  .split(',')
                  .map(t => t.trim())
                  .filter(Boolean)
              })
            )
          }
        />
      </div>
      <TextareaField
        name='description'
        label='Description (Markdown)'
        rows={2}
        value={String(o.description ?? '')}
        onChange={e => apply(d => updateOperation(d, op, { description: e.target.value }))}
      />
      <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
        <Checkbox
          checked={o.deprecated === true}
          onCheckedChange={v => apply(d => updateOperation(d, op, { deprecated: v === true }))}
        />{' '}
        Deprecated
      </label>

      <div className='flex flex-col gap-2'>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Parameters</span>
        {params.map((p, i) => (
          <div key={i} className='flex gap-2 flex-wrap items-center'>
            <div style={{ flex: '1 1 8rem' }}>
              <Input
                size='sm'
                value={p.name}
                onChange={e => setP(params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder='name'
                aria-label='Parameter name'
              />
            </div>
            <div style={{ inlineSize: '7rem' }}>
              <SelectField
                name={`in-${i}`}
                size='sm'
                value={p.in}
                onValueChange={v => setP(params.map((x, j) => (j === i ? { ...x, in: v as FormParam['in'] } : x)))}
                options={['query', 'path', 'header', 'cookie'].map(v => ({ value: v, label: v }))}
              />
            </div>
            <div style={{ inlineSize: '7rem' }}>
              <SelectField
                name={`type-${i}`}
                size='sm'
                value={p.type}
                onValueChange={v => setP(params.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                options={['string', 'integer', 'number', 'boolean', 'array'].map(v => ({ value: v, label: v }))}
              />
            </div>
            <div style={{ flex: '2 1 10rem' }}>
              <Input
                size='sm'
                value={p.description}
                onChange={e => setP(params.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                placeholder='description'
                aria-label='Parameter description'
              />
            </div>
            <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
              <Checkbox
                checked={p.required || p.in === 'path'}
                disabled={p.in === 'path'}
                onCheckedChange={v => setP(params.map((x, j) => (j === i ? { ...x, required: v === true } : x)))}
              />{' '}
              required
            </label>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setP(params.filter((_, j) => j !== i))}
              aria-label='Remove parameter'
            >
              <i className='tabler-trash' aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              setP([...params, { name: '', in: 'query', required: false, type: 'string', description: '' }])
            }
          >
            Add parameter
          </Button>
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Responses</span>
        {responses.map((r, i) => (
          <div key={i} className='flex gap-2 flex-wrap items-center'>
            <div style={{ inlineSize: '6rem' }}>
              <Input
                size='sm'
                value={r.code}
                onChange={e => setR(responses.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
                placeholder='200'
                aria-label='Status code'
                error={!!r.code && !/^([1-5]\d\d|[1-5]XX|default)$/i.test(r.code)}
              />
            </div>
            <div style={{ flex: '1 1 14rem' }}>
              <Input
                size='sm'
                value={r.description}
                onChange={e => setR(responses.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                placeholder='description'
                aria-label='Response description'
              />
            </div>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setR(responses.filter((_, j) => j !== i))}
              aria-label='Remove response'
            >
              <i className='tabler-trash' aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              setR([...responses, { code: responses.some(r => r.code === '400') ? '404' : '400', description: '' }])
            }
          >
            Add response
          </Button>
        </div>
      </div>

      <div>
        <Button size='sm' variant='destructive' onClick={onRemove}>
          Delete operation
        </Button>
      </div>
    </div>
  )
}

// ── Preview (with try-it through the API client) ──────────────────────────

function PreviewTab({ accountId, model }: { accountId: string; model: NonNullable<SpecPreview['model']> }) {
  const onTry: TryHandler = async (_op, req) => {
    if (!req.server) throw new Error('The spec has no server URL to send to')
    const r = await apiClientService.send(accountId, {
      request: newRequest({
        method: req.method as ApiMethod,
        url: joinUrl(req.server, req.path),
        headers: Object.entries(req.headers).map(([key, value]) => ({ key, value, enabled: true })),
        body:
          req.body !== undefined
            ? { type: 'raw', text: req.body, contentType: req.headers['content-type'] ?? 'application/json' }
            : { type: 'none' },
        assertions: []
      }),
      noHistory: true
    })

    if (!r.sent) throw new Error(r.problems.join('; '))
    if (!r.response) throw new Error(r.error?.message ?? 'No answer')

    return {
      status: r.response.status,
      headers: Object.fromEntries(r.response.headers),
      body: r.response.bodyEncoding === 'base64' ? '(binary body)' : r.response.body,
      ms: Math.round(r.response.timings.total),
      truncated: r.response.truncated
    }
  }

  return (
    <SpecDocsView
      model={model}
      onTry={onTry}
      tryNote='Sent from VhyxVoid through the API client, to the server you pick (public addresses only).'
    />
  )
}

// ── Versions ──────────────────────────────────────────────────────────────

function ChangeList({ changes, empty }: { changes: SpecChange[]; empty: string }) {
  if (!changes.length)
    return (
      <Typography variant='body2' style={muted}>
        {empty}
      </Typography>
    )

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {changes.map((c, i) => (
        <li key={i} className='flex items-start gap-2 flex-wrap' style={{ fontSize: 13 }}>
          <Badge size='sm' variant={severityVariant(c.severity)}>
            {c.severity}
          </Badge>
          <code style={{ ...mono, fontSize: 12 }}>{c.location}</code>
          <span>{c.message}</span>
        </li>
      ))}
    </ul>
  )
}

function VersionsTab({
  accountId,
  spec,
  draftChanges,
  onRestored
}: {
  accountId: string
  spec: Spec
  draftChanges: SpecChange[]
  onRestored: () => void
}) {
  const qc = useQueryClient()
  const ready = useBootstrapReady()
  const { data, isLoading } = useQuery({
    queryKey: specKeys.versions(accountId, spec.id),
    queryFn: () => specsService.versions(accountId, spec.id),
    enabled: ready
  })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('draft')
  const diff = useQuery({
    queryKey: ['specs', accountId, spec.id, 'diff', from, to],
    queryFn: () => specsService.diff(accountId, spec.id, from, to),
    enabled: ready && !!from && from !== to
  })

  const restore = useMutation({
    mutationFn: (vid: string) => specsService.restore(accountId, spec.id, vid),
    onSuccess: r => {
      toast.success(`Version ${r.number} is in the draft now`)
      onRestored()
      qc.invalidateQueries({ queryKey: specKeys.one(accountId, spec.id) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const versions = data?.versions ?? []
  const options = [
    { value: 'draft', label: 'Draft' },
    ...versions.map(v => ({ value: v.id, label: `v${v.number}${v.version ? ` (${v.version})` : ''}` }))
  ]

  return (
    <div className='flex flex-col gap-4'>
      {spec.latest && (
        <Card className='p-4'>
          <div className='flex flex-col gap-2'>
            <Typography variant='subtitle2'>Draft compared with v{spec.latest.number}</Typography>
            <ChangeList changes={draftChanges} empty='No changes for clients since the last version.' />
          </div>
        </Card>
      )}

      <Card className='p-4'>
        <div className='flex flex-col gap-3'>
          <Typography variant='subtitle2'>Compare</Typography>
          <div className='flex gap-2 flex-wrap items-end'>
            <div style={{ inlineSize: '12rem' }}>
              <SelectField
                name='from'
                label='From'
                size='sm'
                value={from}
                onValueChange={setFrom}
                options={options.filter(o => o.value !== 'draft')}
                placeholder='A version'
              />
            </div>
            <div style={{ inlineSize: '12rem' }}>
              <SelectField name='to' label='To' size='sm' value={to} onValueChange={setTo} options={options} />
            </div>
          </div>
          {diff.data && (
            <>
              <span className='flex gap-2'>
                <Badge variant='danger'>{diff.data.counts.breaking} breaking</Badge>
                <Badge variant='warning'>{diff.data.counts.warning} warnings</Badge>
                <Badge variant='info'>{diff.data.counts.info} other</Badge>
              </span>
              <ChangeList changes={diff.data.changes} empty='No differences.' />
            </>
          )}
          {diff.error && <Alert variant='danger'>{(diff.error as Error).message}</Alert>}
        </div>
      </Card>

      <div className='flex flex-col gap-2'>
        <Typography variant='subtitle2'>Published versions</Typography>
        {isLoading ? (
          <Skeleton height='6rem' />
        ) : versions.length === 0 ? (
          <Typography variant='body2' style={muted}>
            Nothing published yet. Readers see a version only after you publish it.
          </Typography>
        ) : (
          versions.map(v => (
            <Card key={v.id} className='p-3'>
              <div className='flex items-center gap-2 flex-wrap'>
                <strong>v{v.number}</strong>
                {v.version && (
                  <Badge size='sm' variant='outline'>
                    {v.version}
                  </Badge>
                )}
                {v.counts && v.counts.breaking > 0 && (
                  <Badge size='sm' variant='danger'>
                    {v.counts.breaking} breaking
                  </Badge>
                )}
                <span style={{ ...muted, fontSize: 13 }}>{new Date(v.createdAt).toLocaleString()}</span>
                {v.notes && <span style={{ fontSize: 13 }}>— {v.notes}</span>}
                <span className='flex gap-1' style={{ marginInlineStart: 'auto' }}>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() =>
                      specsService.exportFile(accountId, spec.id, 'yaml', v.id).then(
                        f => download(f.blob, f.name),
                        e => toast.danger((e as Error).message)
                      )
                    }
                  >
                    YAML
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() =>
                      specsService.exportFile(accountId, spec.id, 'json', v.id).then(
                        f => download(f.blob, f.name),
                        e => toast.danger((e as Error).message)
                      )
                    }
                  >
                    JSON
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    loading={restore.isPending && restore.variables === v.id}
                    onClick={() => restore.mutate(v.id)}
                  >
                    Restore to draft
                  </Button>
                </span>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

function PublishDialog({
  accountId,
  spec,
  preview,
  onClose
}: {
  accountId: string
  spec: Spec
  preview: SpecPreview | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')
  const [confirm, setConfirm] = useState(false)
  const breaking = preview?.counts.breaking ?? 0
  const publish = useMutation({
    mutationFn: () => specsService.publish(accountId, spec.id, notes),
    onSuccess: v => {
      toast.success(`Published v${v.number}`)
      qc.invalidateQueries({ queryKey: specKeys.one(accountId, spec.id) })
      qc.invalidateQueries({ queryKey: specKeys.versions(accountId, spec.id) })
      qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Publish v{(spec.latest?.number ?? 0) + 1}</Dialog.Title>
          <div className='flex flex-col gap-3'>
            {spec.latest ? (
              <>
                <Typography variant='body2'>
                  Changes since v{spec.latest.number}, as a client of the API sees them:
                </Typography>
                <ChangeList
                  changes={preview?.changes ?? []}
                  empty='No changes that affect clients (descriptions and examples aren’t compared).'
                />
                {breaking > 0 && (
                  <Alert variant='warning' title={`${breaking} breaking change${breaking === 1 ? '' : 's'}`}>
                    Clients built on v{spec.latest.number} may stop working. Consider a new major version or a
                    deprecation period.
                    <div className='mbs-2'>
                      <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
                        <Checkbox checked={confirm} onCheckedChange={v => setConfirm(v === true)} /> Publish anyway
                      </label>
                    </div>
                  </Alert>
                )}
              </>
            ) : (
              <Typography variant='body2'>
                The first version.{' '}
                {spec.visibility === 'PRIVATE'
                  ? 'The docs stay private until you share them.'
                  : 'Readers see it at once.'}
              </Typography>
            )}
            <TextareaField
              name='notes'
              label='Release notes (optional)'
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder='Added pagination to GET /users'
            />
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={breaking > 0 && !confirm}>
              Publish
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Sharing ───────────────────────────────────────────────────────────────

function SharingTab({ accountId, spec }: { accountId: string; spec: Spec }) {
  const qc = useQueryClient()
  const ready = useBootstrapReady()
  const [visibility, setVisibility] = useState<Visibility>(spec.visibility)
  const [password, setPassword] = useState('')
  const [tryMockId, setTryMockId] = useState(spec.tryMockId ?? '')
  const [hostname, setHostname] = useState(spec.customDomain ?? '')
  const mocks = useQuery({
    queryKey: ['mocks', accountId],
    queryFn: () => mocksService.overview(accountId),
    enabled: ready
  })
  const canManage = spec.canManage !== false
  const limits = spec.limits ?? { protectedDocs: false, customDomains: false }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: specKeys.one(accountId, spec.id) })
    qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
  }

  const share = useMutation({
    mutationFn: () =>
      specsService.sharing(accountId, spec.id, {
        visibility,
        ...(password ? { password } : {}),
        tryMockId: tryMockId || null
      }),
    onSuccess: () => {
      toast.success('Sharing saved')
      setPassword('')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const domain = useMutation({
    mutationFn: (h: string | null) => specsService.setDomain(accountId, spec.id, h),
    onSuccess: () => {
      toast.success('Saved')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const check = useMutation({
    mutationFn: () => specsService.checkDomain(accountId, spec.id),
    onSuccess: r => {
      if (r.customDomainVerified)
        toast.success(r.routed ? 'Verified and pointing at us' : 'Verified. Now point the CNAME at us.')
      else toast.warning(r.error ?? 'Not verified yet: DNS can take a few minutes')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })

  const changed = visibility !== spec.visibility || !!password || (tryMockId || null) !== spec.tryMockId
  const needsPassword = visibility === 'PASSWORD' && !spec.hasPassword && password.length < 6

  return (
    <div className='flex flex-col gap-4'>
      {!canManage && <Alert variant='info'>Only owners and admins can change how docs are shared.</Alert>}
      <Card className='p-4'>
        <div className='flex flex-col gap-3'>
          <Typography variant='subtitle2'>Who can read the docs</Typography>
          <SelectField
            name='visibility'
            label='Visibility'
            value={visibility}
            onValueChange={v => setVisibility(v as Visibility)}
            disabled={!canManage}
            options={[
              { value: 'PRIVATE', label: 'Private: only this workspace, in the dashboard' },
              { value: 'PUBLIC', label: 'Public: anyone with the link' },
              {
                value: 'PASSWORD',
                label: limits.protectedDocs
                  ? 'Password: anyone with the link and the password'
                  : 'Password (not on your plan)'
              }
            ]}
          />
          {visibility === 'PASSWORD' && (
            <TextField
              name='password'
              type='password'
              label={spec.hasPassword ? 'New password (leave empty to keep it)' : 'Password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              hint='At least 6 characters. Changing it signs every reader out.'
              disabled={!canManage || !limits.protectedDocs}
            />
          )}
          {visibility === 'PASSWORD' && !limits.protectedDocs && (
            <Alert variant='info'>
              <Link href={`/organizations/${accountId}/billing`}>Upgrade</Link> to protect docs with a password.
            </Alert>
          )}
          <SelectField
            name='tryMock'
            label='Try it on the shared page'
            value={tryMockId || 'none'}
            onValueChange={v => setTryMockId(v === 'none' ? '' : v)}
            disabled={!canManage}
            hint='Readers’ requests go to this mock API (never to other hosts). Without one, the page sends from the reader’s browser to your server URL, which needs CORS.'
            options={[
              { value: 'none', label: 'No mock: send from the browser' },
              ...(mocks.data?.mocks ?? []).map(m => ({ value: m.id, label: m.name }))
            ]}
          />
          <div className='flex items-center gap-2 flex-wrap'>
            <Button
              size='sm'
              onClick={() => share.mutate()}
              loading={share.isPending}
              disabled={!canManage || !changed || needsPassword}
            >
              Save sharing
            </Button>
            {!spec.latest && visibility !== 'PRIVATE' && (
              <span style={{ ...muted, fontSize: 13 }}>Publish a version: readers only see published versions.</span>
            )}
          </div>
          {spec.visibility !== 'PRIVATE' && (
            <div className='flex items-center gap-2 flex-wrap'>
              <code style={{ ...mono, wordBreak: 'break-all' }}>{spec.publicUrl}</code>
              <Button size='sm' variant='ghost' onClick={() => copy(spec.publicUrl)}>
                Copy
              </Button>
              <a href={spec.publicUrl} target='_blank' rel='noreferrer'>
                <Button size='sm' variant='outline'>
                  Open
                </Button>
              </a>
            </div>
          )}
        </div>
      </Card>

      <Card className='p-4'>
        <div className='flex flex-col gap-3'>
          <Typography variant='subtitle2'>Your own domain</Typography>
          {!limits.customDomains ? (
            <Alert variant='info'>
              <Link href={`/organizations/${accountId}/billing`}>Upgrade</Link> to serve the docs on a domain like
              docs.acme.dev.
            </Alert>
          ) : (
            <>
              <div className='flex gap-2 flex-wrap items-end'>
                <div style={{ flex: '1 1 16rem' }}>
                  <TextField
                    name='hostname'
                    label='Hostname'
                    placeholder='docs.acme.dev'
                    value={hostname}
                    onChange={e => setHostname(e.target.value.trim().toLowerCase())}
                    disabled={!canManage}
                  />
                </div>
                <Button
                  size='sm'
                  onClick={() => domain.mutate(hostname)}
                  loading={domain.isPending}
                  disabled={!canManage || !hostname || hostname === spec.customDomain}
                >
                  {spec.customDomain ? 'Change' : 'Add'}
                </Button>
                {spec.customDomain && (
                  <Button size='sm' variant='ghost' onClick={() => domain.mutate(null)} disabled={!canManage}>
                    Remove
                  </Button>
                )}
              </div>
              {spec.customDomain && (
                <div className='flex flex-col gap-2'>
                  <span className='flex items-center gap-2'>
                    <code style={mono}>{spec.customDomain}</code>
                    <Badge size='sm' variant={spec.customDomainVerified ? 'success' : 'warning'}>
                      {spec.customDomainVerified ? 'verified' : 'waiting for DNS'}
                    </Badge>
                  </span>
                  {spec.domainRecords && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {[spec.domainRecords.verification, spec.domainRecords.routing].filter(Boolean).map(r => (
                            <tr key={r!.type}>
                              <td style={{ padding: '4px 12px 4px 0' }}>
                                <Badge size='sm' variant='outline'>
                                  {r!.type}
                                </Badge>
                              </td>
                              <td style={{ padding: '4px 12px 4px 0' }}>
                                <code style={mono}>{r!.name}</code>
                              </td>
                              <td style={{ padding: '4px 0' }}>
                                <button
                                  type='button'
                                  onClick={() => copy(r!.value)}
                                  style={{
                                    ...mono,
                                    background: 'none',
                                    border: 0,
                                    padding: 0,
                                    color: 'var(--vhyx-color-accent)',
                                    cursor: 'copy',
                                    wordBreak: 'break-all',
                                    textAlign: 'start'
                                  }}
                                >
                                  {r!.value}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div>
                    <Button size='sm' variant='outline' onClick={() => check.mutate()} loading={check.isPending}>
                      Check DNS now
                    </Button>
                  </div>
                  <Typography variant='caption' style={muted}>
                    The TXT record proves the domain is yours; the CNAME sends readers to us. HTTPS certificates are
                    issued on the first visit.
                  </Typography>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <DangerZone accountId={accountId} spec={spec} canManage={canManage} />
    </div>
  )
}

function DangerZone({ accountId, spec, canManage }: { accountId: string; spec: Spec; canManage: boolean }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [name, setName] = useState(spec.name)
  const [slug, setSlug] = useState(spec.slug)
  const [confirm, setConfirm] = useState(false)
  const rename = useMutation({
    mutationFn: () => specsService.save(accountId, spec.id, { name, slug, expectedVersion: spec.version }),
    onSuccess: () => {
      toast.success('Saved')
      qc.invalidateQueries({ queryKey: specKeys.one(accountId, spec.id) })
      qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })
  const remove = useMutation({
    mutationFn: () => specsService.remove(accountId, spec.id),
    onSuccess: () => {
      toast.success('Deleted')
      qc.invalidateQueries({ queryKey: specKeys.overview(accountId) })
      router.push(`/organizations/${accountId}/api-docs`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Card className='p-4'>
      <div className='flex flex-col gap-3'>
        <Typography variant='subtitle2'>Name and address</Typography>
        <div className='flex gap-2 flex-wrap items-end'>
          <div style={{ flex: '1 1 14rem' }}>
            <TextField name='specName' label='Name' value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 14rem' }}>
            <TextField
              name='slug'
              label='Slug'
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())}
              error={slug && !SLUG_RE.test(slug) ? 'Lowercase letters, digits and dashes' : undefined}
              hint='Changing it breaks links to the old address.'
            />
          </div>
          <Button
            size='sm'
            variant='secondary'
            onClick={() => rename.mutate()}
            loading={rename.isPending}
            disabled={!name.trim() || !SLUG_RE.test(slug) || (name === spec.name && slug === spec.slug)}
          >
            Save
          </Button>
        </div>
        {canManage && (
          <div className='flex items-center gap-2 flex-wrap'>
            {!confirm ? (
              <Button size='sm' variant='destructive' onClick={() => setConfirm(true)}>
                Delete spec
              </Button>
            ) : (
              <>
                <span style={{ fontSize: 13 }}>Delete {spec.name} and every version? Shared links stop working.</span>
                <Button size='sm' variant='destructive' onClick={() => remove.mutate()} loading={remove.isPending}>
                  Delete
                </Button>
                <Button size='sm' variant='ghost' onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Generate a mock / a test collection ───────────────────────────────────

function GenerateDialog({
  accountId,
  spec,
  text,
  kind,
  onClose
}: {
  accountId: string
  spec: Spec
  text: string
  kind: 'mock' | 'collection'
  onClose: () => void
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const [name, setName] = useState(kind === 'mock' ? `${spec.name} mock` : `${spec.name} tests`)
  const [label, setLabel] = useState(labelFromName(spec.name) || 'api')
  const [link, setLink] = useState(!spec.tryMockId)

  const make = useMutation({
    mutationFn: async () => {
      if (kind === 'collection') {
        const c = await apiClientService.createCollection(accountId, { name, document: text })

        return `/organizations/${accountId}/api-client/${c.id}`
      }

      const m = await mocksService.create(accountId, { name, label, document: text })

      if (link && spec.canManage !== false)
        await specsService
          .sharing(accountId, spec.id, { visibility: spec.visibility, tryMockId: m.id })
          .catch(() => undefined)

      return `/organizations/${accountId}/mocks/${m.id}`
    },
    onSuccess: href => {
      toast.success(kind === 'mock' ? 'Mock API created from the spec' : 'Test collection created from the spec')
      qc.invalidateQueries({ queryKey: specKeys.one(accountId, spec.id) })
      router.push(href)
    },
    onError: e => toast.danger((e as Error).message)
  })

  const labelOk = LABEL_RE.test(label) && !label.includes('--')

  return (
    <Dialog open onOpenChange={o => !o && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>
            {kind === 'mock' ? 'Make a mock API from this spec' : 'Make a test collection from this spec'}
          </Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              make.mutate()
            }}
          >
            <Typography variant='body2' style={muted}>
              {kind === 'mock'
                ? 'Every operation becomes an endpoint answering with its example (or one built from the schema). Uses the current draft.'
                : 'Every operation becomes a request with a status check, against the spec’s first server. Uses the current draft.'}
            </Typography>
            <TextField name='name' label='Name' value={name} onChange={e => setName(e.target.value)} />
            {kind === 'mock' && (
              <>
                <TextField
                  name='label'
                  label='Label (part of the URL)'
                  value={label}
                  onChange={e => setLabel(e.target.value.toLowerCase())}
                  error={labelOk ? undefined : 'Lowercase letters, digits and single hyphens.'}
                />
                <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
                  <Checkbox checked={link} onCheckedChange={v => setLink(v === true)} /> Use it for Try it on the shared
                  docs
                </label>
              </>
            )}
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={make.isPending} disabled={!name.trim() || (kind === 'mock' && !labelOk)}>
                Create
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
