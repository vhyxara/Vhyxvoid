'use client'

// One team document: markdown with a live preview, autosave (with a
// conflict guard when two people edit), the outline, version history with a
// diff, and comments (on the document or on one heading).

import { useCallback, useEffect, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Drawer, SelectField, Skeleton, Tabs, toast } from '@vhyxui/react'

import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import {
  teamKeys,
  teamService,
  type Comment,
  type DocsOverview,
  type Person,
  type TeamDoc
} from '@/api/infrastructure/services/team.service'
import {
  CardList,
  Composer,
  LiveDot,
  MentionTextarea,
  RICH_CSS,
  RichText,
  ShareToChatButton,
  muted,
  mono,
  usePeople,
  useTeamSocket
} from './TeamParts'
import { buildTree, dayLabel, timeLabel, toEditable, toStored, type TreeNode } from './teamForm'

type Save = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

export default function DocView({ accountId, docId }: { accountId: string; docId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const router = useRouter()
  const {
    data: doc,
    error,
    isLoading
  } = useQuery({
    queryKey: teamKeys.doc(accountId, docId),
    queryFn: () => teamService.doc(accountId, docId),
    enabled: ready
  })
  const { data: tree } = useQuery({
    queryKey: teamKeys.docs(accountId),
    queryFn: () => teamService.docs(accountId),
    enabled: ready
  })
  const people = usePeople(accountId, ready)
  const socket = useTeamSocket(accountId, ready && !!doc?.writable)
  const me = useQuery({
    queryKey: teamKeys.chat(accountId),
    queryFn: () => teamService.chat(accountId),
    enabled: ready
  }).data?.me

  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<Save>('saved')
  const [mode, setMode] = useState<'write' | 'split' | 'read'>('read')
  const [panel, setPanel] = useState<'history' | 'comments' | null>(null)
  const [newer, setNewer] = useState(false)
  const loaded = useRef<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  // Load (and reload after someone else's save, when we have no edits).
  useEffect(() => {
    if (!doc || !people.length) return
    if (loaded.current === `${doc.id}:${doc.version}`) return
    if (state === 'dirty' || state === 'saving') return
    const e = toEditable(doc.body, people)

    setTitle(doc.title)
    setText(e.text)
    setPicked(e.picked)
    setVersion(doc.version)
    setNewer(false)
    if (loaded.current === null)
      setMode(
        doc.writable && window.matchMedia('(min-width: 1100px)').matches && !doc.body
          ? 'split'
          : doc.writable && !doc.body
            ? 'write'
            : 'read'
      )
    loaded.current = `${doc.id}:${doc.version}`
  }, [doc, people, state])

  // Someone else saved: refresh if we have nothing unsaved, else say so.
  useEffect(
    () =>
      socket.subscribe(e => {
        if (e.kind !== 'doc' || e.payload.docId !== docId || e.payload.by === me) return
        if (e.payload.deleted) {
          toast.warning('This document was deleted')
          router.push(`/organizations/${accountId}/team/docs`)

          return
        }

        if (state === 'dirty' || state === 'saving') setNewer(true)
        else qc.invalidateQueries({ queryKey: teamKeys.doc(accountId, docId) })
      }),
    [socket, docId, me, state, qc, accountId, router]
  )

  const save = useCallback(async () => {
    if (!doc || state === 'saving' || state === 'conflict') return
    setState('saving')

    try {
      const r = await teamService.saveDoc(accountId, docId, {
        title: title.trim() || 'Untitled',
        body: toStored(text, picked),
        expectedVersion: version
      })

      setVersion(r.version)
      loaded.current = `${docId}:${r.version}`
      setState('saved')
      qc.setQueryData(teamKeys.doc(accountId, docId), (prev: TeamDoc | undefined) =>
        prev
          ? {
              ...prev,
              title: r.title,
              version: r.version,
              outline: r.outline,
              latestVersion: r.latestVersion,
              updatedAt: r.updatedAt,
              body: toStored(text, picked)
            }
          : prev
      )
      qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) })
    } catch (e) {
      const conflict = /saved this document|same moment/i.test((e as Error).message)

      setState(conflict ? 'conflict' : 'error')
      if (!conflict) toast.danger((e as Error).message)
    }
  }, [doc, state, accountId, docId, title, text, picked, version, qc])

  // Autosave 1.5 s after typing stops.
  useEffect(() => {
    if (state !== 'dirty') return
    const t = setTimeout(() => void save(), 1500)

    return () => clearTimeout(t)
  }, [state, text, title, save])

  useEffect(() => {
    if (state !== 'dirty' && state !== 'saving') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()

    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  const edit = (t: string) => {
    setText(t)
    if (state !== 'conflict') setState('dirty')
  }

  const remove = useMutation({
    mutationFn: () => teamService.deleteDoc(accountId, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) })
      router.push(`/organizations/${accountId}/team/docs`)
    },
    onError: e => toast.danger((e as Error).message)
  })
  const move = useMutation({
    mutationFn: (folderId: string | null) =>
      teamService.saveDoc(accountId, docId, { folderId, expectedVersion: version }),
    onSuccess: r => {
      setVersion(r.version)
      loaded.current = `${docId}:${r.version}`
      qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) })
      qc.invalidateQueries({ queryKey: teamKeys.doc(accountId, docId) })
      toast.success('Moved')
    },
    onError: e => toast.danger((e as Error).message)
  })

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !doc) return <Skeleton height='30rem' />

  const comments = Object.values(doc.openComments).reduce((a, b) => a + b, 0)
  const crumbs = tree ? path(tree, doc.folderId) : []
  const preview = (
    <article style={{ minInlineSize: 0 }}>
      <RichText text={toStored(text, picked)} people={people} me={me} anchors />
      {doc.cards.some(c => c.card) && (
        <section style={{ marginBlockStart: 24 }}>
          <strong style={{ fontSize: 13 }}>Linked in this document</strong>
          <CardList cards={doc.cards.map(c => c.card)} />
        </section>
      )}
    </article>
  )

  return (
    <div className='flex flex-col gap-3'>
      <style>{`${RICH_CSS}
.vv-doc { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); }
.vv-doc-outline { display: none; }
.vv-doc-split { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1100px) {
  .vv-doc { grid-template-columns: minmax(0, 1fr) 13rem; }
  .vv-doc-outline { display: block; position: sticky; top: 16px; align-self: start; }
  .vv-doc-split[data-mode="split"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}`}</style>
      <nav aria-label='Breadcrumb' style={{ ...muted, fontSize: 13 }} className='flex items-center gap-1 flex-wrap'>
        <Link href={`/organizations/${accountId}/team/docs`}>Docs</Link>
        {crumbs.map(c => (
          <span key={c}> / {c}</span>
        ))}
      </nav>
      <div className='flex items-start gap-3 flex-wrap'>
        <input
          aria-label='Title'
          value={title}
          readOnly={!doc.writable}
          onChange={e => {
            setTitle(e.target.value)
            setState('dirty')
          }}
          style={{
            flex: '1 1 20rem',
            minInlineSize: 0,
            fontSize: 26,
            fontWeight: 700,
            border: 0,
            background: 'transparent',
            color: 'inherit',
            outline: 'none',
            padding: 0
          }}
        />
        <div className='flex items-center gap-2 flex-wrap'>
          <SaveState state={state} />
          {doc.writable && <LiveDot status={socket.status} />}
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setPanel('comments')}
            icon={<i className='tabler-message-2' />}
          >
            Comments{comments ? ` (${comments})` : ''}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setPanel('history')} icon={<i className='tabler-history' />}>
            History
          </Button>
          <ShareToChatButton accountId={accountId} path={`/organizations/${accountId}/team/docs/${docId}`} />
        </div>
      </div>
      <div className='flex items-center gap-3 flex-wrap' style={{ ...muted, fontSize: 12 }}>
        <span>
          {doc.updatedBy ? `Last edited by ${doc.updatedBy}, ` : ''}
          {dayLabel(doc.updatedAt).toLowerCase()} {timeLabel(doc.updatedAt)} · version {doc.latestVersion}
        </span>
        {doc.writable && (
          <Tabs value={mode} onValueChange={v => setMode(v as typeof mode)} variant='pills'>
            <Tabs.List aria-label='View'>
              <Tabs.Trigger value='write'>Write</Tabs.Trigger>
              <Tabs.Trigger value='split'>Split</Tabs.Trigger>
              <Tabs.Trigger value='read'>Read</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        )}
      </div>

      {newer && (
        <Alert variant='warning'>
          Someone else saved this document while you were editing. Your next save will be refused; copy your changes,
          then reload.
        </Alert>
      )}
      {state === 'conflict' && (
        <Alert variant='danger' title='Not saved: someone saved first'>
          Your text is still here. Copy what you need, then{' '}
          <Button
            size='sm'
            variant='link'
            onClick={() => {
              navigator.clipboard.writeText(text).catch(() => undefined)
              loaded.current = null
              setState('saved')
              qc.invalidateQueries({ queryKey: teamKeys.doc(accountId, docId) })
              toast.info('Your version is on the clipboard')
            }}
          >
            load their version (yours goes to the clipboard)
          </Button>
          .
        </Alert>
      )}
      {!doc.writable && <Alert variant='info'>Read-only right now.</Alert>}

      <div className='vv-doc'>
        <div className='vv-doc-split' data-mode={mode}>
          {mode !== 'read' && (
            <MentionTextarea
              ref={area}
              label='Document (Markdown)'
              value={text}
              onChange={edit}
              onPick={(name, id) => setPicked(p => ({ ...p, [name]: id }))}
              people={people}
              me={me}
              rows={28}
              placeholder={
                '# Heading\n\nWrite in Markdown. @ mentions someone; paste a dashboard link to embed it as a card.'
              }
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                  e.preventDefault()
                  void save()
                }
              }}
            />
          )}
          {mode !== 'write' && preview}
        </div>
        <aside className='vv-doc-outline' aria-label='Outline'>
          {doc.outline.length > 0 && (
            <>
              <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, ...muted }}>
                On this page
              </strong>
              <ul
                style={{
                  listStyle: 'none',
                  margin: '8px 0 0',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}
              >
                {doc.outline.map(h => (
                  <li key={h.anchor} style={{ paddingInlineStart: (h.level - 1) * 10, fontSize: 13 }}>
                    <a href={`#${h.anchor}`} style={{ color: 'inherit' }}>
                      {h.text}
                    </a>
                    {doc.openComments[h.anchor] ? (
                      <Badge size='sm' variant='info' style={{ marginInlineStart: 4 }}>
                        {doc.openComments[h.anchor]}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          {doc.writable && tree && (
            <div style={{ marginBlockStart: 16 }}>
              <SelectField
                name='folder'
                label='Folder'
                size='sm'
                value={doc.folderId ?? 'root'}
                onValueChange={v => move.mutate(v === 'root' ? null : v)}
                options={folderOptions(tree)}
              />
            </div>
          )}
          {doc.canDelete && (
            <Button
              size='sm'
              variant='ghost'
              style={{ marginBlockStart: 12 }}
              onClick={() => window.confirm(`Delete “${doc.title}” and its history?`) && remove.mutate()}
            >
              Delete document
            </Button>
          )}
        </aside>
      </div>

      {panel === 'history' && (
        <HistoryDrawer
          accountId={accountId}
          doc={doc}
          onClose={() => setPanel(null)}
          onRestored={() => ((loaded.current = null), setState('saved'))}
        />
      )}
      {panel === 'comments' && (
        <CommentsDrawer accountId={accountId} doc={doc} people={people} me={me} onClose={() => setPanel(null)} />
      )}
    </div>
  )
}

function SaveState({ state }: { state: Save }) {
  const t = {
    saved: 'Saved',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    conflict: 'Not saved',
    error: 'Save failed'
  }[state]
  const v = state === 'saved' ? 'success' : state === 'conflict' || state === 'error' ? 'danger' : 'default'

  return (
    <Badge size='sm' variant={v} aria-live='polite'>
      {t}
    </Badge>
  )
}

function path(o: DocsOverview, folderId: string | null): string[] {
  const byId = new Map(o.folders.map(f => [f.id, f]))
  const out: string[] = []

  for (
    let at = folderId ? byId.get(folderId) : undefined, i = 0;
    at && i < 50;
    at = at.parentId ? byId.get(at.parentId) : undefined, i++
  )
    out.unshift(at.name)

  return out
}

function folderOptions(o: DocsOverview) {
  const out = [{ value: 'root', label: 'Top level' }]
  const walk = (n: TreeNode, prefix: string) =>
    n.children.forEach(c => {
      out.push({ value: c.folder!.id, label: `${prefix}${c.folder!.name}` })
      walk(c, `${prefix}${c.folder!.name} / `)
    })

  walk(buildTree(o.folders, []), '')

  return out
}

function HistoryDrawer({
  accountId,
  doc,
  onClose,
  onRestored
}: {
  accountId: string
  doc: TeamDoc
  onClose: () => void
  onRestored: () => void
}) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['team', accountId, 'docVersions', doc.id, doc.latestVersion],
    queryFn: () => teamService.docVersions(accountId, doc.id)
  })
  const [pick, setPick] = useState<number | null>(null)
  const diff = useQuery({
    queryKey: ['team', accountId, 'docDiff', doc.id, pick, doc.version],
    queryFn: () => teamService.docDiff(accountId, doc.id, pick!, 'current'),
    enabled: !!pick
  })
  const restore = useMutation({
    mutationFn: (n: number) => teamService.restoreDoc(accountId, doc.id, n),
    onSuccess: (_, n) => {
      toast.success(`Version ${n} restored`)
      onRestored()
      qc.invalidateQueries({ queryKey: teamKeys.doc(accountId, doc.id) })
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })
  return (
    <Drawer open onOpenChange={o => !o && onClose()} side='right' size='lg'>
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>History</Drawer.Title>
          </Drawer.Header>
          <div className='flex flex-col gap-3' style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
            <span style={{ ...muted, fontSize: 13 }}>
              A version is a session of edits by one person (saves within 10 minutes are merged).
            </span>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(data?.versions ?? []).map(v => (
                <li key={v.number}>
                  <button
                    type='button'
                    onClick={() => setPick(v.number)}
                    aria-pressed={pick === v.number}
                    style={{
                      inlineSize: '100%',
                      textAlign: 'start',
                      border: `1px solid ${pick === v.number ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
                      borderRadius: 8,
                      background: 'none',
                      color: 'inherit',
                      padding: '6px 10px',
                      cursor: 'pointer'
                    }}
                  >
                    <strong>v{v.number}</strong>{' '}
                    {v.number === doc.latestVersion && (
                      <Badge size='sm' variant='success'>
                        latest
                      </Badge>
                    )}{' '}
                    <span style={{ ...muted, fontSize: 13 }}>
                      {v.author ?? 'Someone'} · {dayLabel(v.updatedAt)} {timeLabel(v.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {pick && diff.data && (
              <section className='flex flex-col gap-2'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <strong style={{ fontSize: 14 }}>v{pick} → now</strong>
                  <Badge size='sm' variant='success'>
                    +{diff.data.added}
                  </Badge>
                  <Badge size='sm' variant='danger'>
                    −{diff.data.removed}
                  </Badge>
                  {pick !== doc.latestVersion && doc.writable && (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => restore.mutate(pick)}
                      loading={restore.isPending}
                      style={{ marginInlineStart: 'auto' }}
                    >
                      Restore v{pick}
                    </Button>
                  )}
                </div>
                {diff.data.titleChanged && (
                  <span style={{ fontSize: 13 }}>
                    Title: <del>{diff.data.titleChanged.from}</del> → {diff.data.titleChanged.to}
                  </span>
                )}
                <pre
                  style={{
                    ...mono,
                    margin: 0,
                    fontSize: 12,
                    border: '1px solid var(--vhyx-color-border)',
                    borderRadius: 8,
                    overflow: 'auto',
                    maxBlockSize: '60vh'
                  }}
                >
                  {diff.data.lines.length === 0 ? (
                    <span style={{ ...muted, padding: 8, display: 'block' }}>No differences.</span>
                  ) : (
                    diff.data.lines.map((l, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '0 8px',
                          whiteSpace: 'pre-wrap',
                          background:
                            l.op === '+' ? 'rgba(22,163,74,.15)' : l.op === '-' ? 'rgba(220,38,38,.15)' : undefined
                        }}
                      >
                        <span aria-hidden style={{ userSelect: 'none', ...muted }}>
                          {l.op === ' ' ? ' ' : l.op}{' '}
                        </span>
                        <span
                          style={{
                            position: 'absolute',
                            inlineSize: 1,
                            blockSize: 1,
                            overflow: 'hidden',
                            clip: 'rect(0 0 0 0)'
                          }}
                        >
                          {l.op === '+' ? 'added: ' : l.op === '-' ? 'removed: ' : ''}
                        </span>
                        {l.text || ' '}
                      </div>
                    ))
                  )}
                </pre>
              </section>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}

function CommentsDrawer({
  accountId,
  doc,
  people,
  me,
  onClose
}: {
  accountId: string
  doc: TeamDoc
  people: Person[]
  me?: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const target = `doc:${doc.id}`
  const { data } = useQuery({
    queryKey: teamKeys.comments(accountId, target),
    queryFn: () => teamService.comments(accountId, target)
  })
  const [anchor, setAnchor] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: teamKeys.comments(accountId, target) })
    qc.invalidateQueries({ queryKey: teamKeys.doc(accountId, doc.id) })
  }
  const list = (data?.comments ?? []).filter(c => !c.deleted && (showResolved || !c.resolved))
  const headings = new Map(doc.outline.map(h => [h.anchor, h.text]))

  return (
    <Drawer open onOpenChange={o => !o && onClose()} side='right' size='md'>
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Comments</Drawer.Title>
          </Drawer.Header>
          <div className='flex flex-col gap-3' style={{ padding: '0 16px 16px', overflowY: 'auto' }}>
            <label className='flex items-center gap-2' style={{ fontSize: 13 }}>
              <input type='checkbox' checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show
              resolved
            </label>
            {list.length === 0 && <span style={muted}>No open comments.</span>}
            {list.map(c => (
              <CommentItem
                key={c.id}
                accountId={accountId}
                c={c}
                people={people}
                me={me}
                heading={c.anchor ? (headings.get(c.anchor) ?? c.anchor) : null}
                onChanged={refresh}
              />
            ))}
            {doc.writable && (
              <div
                className='flex flex-col gap-2'
                style={{ borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 12 }}
              >
                <SelectField
                  name='anchor'
                  label='About'
                  size='sm'
                  value={anchor || 'doc'}
                  onValueChange={v => setAnchor(v === 'doc' ? '' : v)}
                  options={[
                    { value: 'doc', label: 'The whole document' },
                    ...doc.outline.map(h => ({ value: h.anchor, label: `${'· '.repeat(h.level - 1)}${h.text}` }))
                  ]}
                />
                <Composer
                  people={people}
                  me={me}
                  label='Comment'
                  placeholder='Add a comment'
                  enterSends={false}
                  minRows={2}
                  submitLabel='Comment'
                  onSubmit={async body => {
                    try {
                      await teamService.comment(accountId, { target, body, anchor: anchor || null })
                      refresh()

                      return true
                    } catch (e) {
                      toast.danger((e as Error).message)

                      return false
                    }
                  }}
                />
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}

export function CommentItem({
  accountId,
  c,
  people,
  me,
  heading,
  onChanged,
  resolvable = true
}: {
  accountId: string
  c: Comment
  people: Person[]
  me?: string
  heading?: string | null
  onChanged: () => void
  resolvable?: boolean
}) {
  const [confirm, setConfirm] = useState(false)
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onChanged()
    } catch (e) {
      toast.danger((e as Error).message)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--vhyx-color-border)',
        borderRadius: 10,
        padding: '8px 12px',
        opacity: c.resolved ? 0.6 : 1
      }}
    >
      <div className='flex items-center gap-2 flex-wrap' style={{ fontSize: 13 }}>
        <strong>{c.author}</strong>
        <span style={muted}>
          {dayLabel(c.createdAt)} {timeLabel(c.createdAt)}
          {c.editedAt ? ' (edited)' : ''}
        </span>
        {heading && (
          <Badge size='sm' variant='outline'>
            § {heading}
          </Badge>
        )}
        {c.resolved && (
          <Badge size='sm' variant='success'>
            resolved
          </Badge>
        )}
      </div>
      <RichText text={c.body} people={people} me={me} compact />
      <div className='flex gap-1' style={{ marginBlockStart: 4 }}>
        {resolvable && (
          <Button
            size='sm'
            variant='ghost'
            onClick={() => act(() => teamService.updateComment(accountId, c.id, { resolved: !c.resolved }))}
          >
            {c.resolved ? 'Reopen' : 'Resolve'}
          </Button>
        )}
        {c.authorId === me &&
          (confirm ? (
            <Button
              size='sm'
              variant='destructive'
              onClick={() => act(() => teamService.deleteComment(accountId, c.id))}
            >
              Delete?
            </Button>
          ) : (
            <Button size='sm' variant='ghost' onClick={() => setConfirm(true)}>
              Delete
            </Button>
          ))}
      </div>
    </div>
  )
}
