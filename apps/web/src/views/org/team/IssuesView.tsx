'use client'

// The tracker: issues as a list or a board, filtered with a small syntax
// ("status:todo assignee:me label:bug login"). The view and filter are in the
// URL so they can be shared.

import { useEffect, useMemo, useState, type DragEvent } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Alert,
  Badge,
  Button,
  Dialog,
  Input,
  SelectField,
  Skeleton,
  Tabs,
  TextareaField,
  TextField,
  toast
} from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  teamKeys,
  teamService,
  type IssuePriority,
  type IssueStatus,
  type IssueSummary,
  type IssuesOverview
} from '@/api/infrastructure/services/team.service'
import { LiveDot, PersonAvatar, muted, useTeamSocket } from './TeamParts'
import {
  PRIORITY_ICON,
  PRIORITY_LABEL,
  STATUS_ICON,
  STATUS_LABEL,
  dropNeighbours,
  dueState,
  moveInColumns
} from './teamForm'

const BOARD: IssueStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']
const QUICK = [
  { label: 'Open', q: '' },
  { label: 'Mine', q: 'assignee:me' },
  { label: 'Unassigned', q: 'assignee:none' },
  { label: 'Overdue', q: 'due:overdue' },
  { label: 'Closed', q: 'is:closed' }
]

export default function IssuesView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const params = useSearchParams()
  const router = useRouter()
  const view = params.get('view') === 'board' ? 'board' : 'list'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [query, setQuery] = useState(q)
  const [sort, setSort] = useState(params.get('sort') ?? 'updated')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300)

    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const next = new URLSearchParams()

    if (view === 'board') next.set('view', 'board')
    if (query) next.set('q', query)
    if (sort !== 'updated') next.set('sort', sort)
    router.replace(`?${next.toString()}`, { scroll: false })
  }, [view, query, sort, router])

  const boardQuery = view === 'board' && !/\b(is|status):/.test(query) ? `${query} is:all`.trim() : query
  const key = [...teamKeys.issues(accountId), boardQuery, view === 'board' ? 'rank' : sort]
  const {
    data: o,
    isLoading,
    error
  } = useQuery({
    queryKey: key,
    queryFn: () => teamService.issues(accountId, boardQuery, view === 'board' ? 'rank' : sort),
    enabled: ready,
    placeholderData: prev => prev
  })
  const socket = useTeamSocket(accountId, ready && !!o?.enabled)
  const atLimit = !!o && o.limits.issues >= o.limits.maxIssues
  const setView = (v: string) => {
    const next = new URLSearchParams(params.toString())

    if (v === 'board') next.set('view', 'board')
    else next.delete('view')
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  return (
    <div className='flex flex-col gap-4'>
      <PageHeader
        title='Issues'
        description='Bugs and tasks next to the APIs they are about: link endpoints, requests, runs and docs; assign, prioritise, and move them across the board.'
      />
      <div className='flex items-end gap-2 flex-wrap'>
        <div style={{ flex: '1 1 22rem' }}>
          <label htmlFor='issue-filter' style={{ fontSize: 13, fontWeight: 500 }}>
            Filter
          </label>
          <Input
            id='issue-filter'
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder='status:todo assignee:me label:bug priority:high due:overdue text…'
            style={{ fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 }}
          />
        </div>
        {view === 'list' && (
          <div style={{ inlineSize: '11rem' }}>
            <SelectField
              name='sort'
              label='Sort'
              value={sort}
              onValueChange={setSort}
              options={[
                { value: 'updated', label: 'Recently updated' },
                { value: 'created', label: 'Newest' },
                { value: 'priority', label: 'Priority' },
                { value: 'due', label: 'Due date' },
                { value: 'number', label: 'Number' }
              ]}
            />
          </div>
        )}
        <Button
          onClick={() => setCreating(true)}
          disabled={!o?.enabled || atLimit}
          icon={<i className='tabler-plus' />}
        >
          New issue
        </Button>
      </div>
      <div className='flex items-center gap-2 flex-wrap'>
        {QUICK.map(x => (
          <Button key={x.label} size='sm' variant={query === x.q ? 'secondary' : 'ghost'} onClick={() => setQ(x.q)}>
            {x.label}
          </Button>
        ))}
        {o?.labels.slice(0, 8).map(l => (
          <Button
            key={l}
            size='sm'
            variant={query === `label:${l}` ? 'secondary' : 'ghost'}
            onClick={() => setQ(`label:${l}`)}
          >
            #{l}
          </Button>
        ))}
        <span style={{ marginInlineStart: 'auto' }} className='flex items-center gap-3'>
          {o?.enabled && <LiveDot status={socket.status} />}
          <Tabs value={view} onValueChange={setView} variant='pills'>
            <Tabs.List aria-label='View'>
              <Tabs.Trigger value='list'>List</Tabs.Trigger>
              <Tabs.Trigger value='board'>Board</Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </span>
      </div>

      {error && <Alert variant='danger'>{(error as Error).message}</Alert>}
      {o && !o.enabled && <Alert variant='info'>Read-only: the team space is off here or not on your plan.</Alert>}
      {atLimit && (
        <Alert variant='warning'>
          You have {o!.limits.issues} of {o!.limits.maxIssues} issues. Delete old ones or upgrade.
        </Alert>
      )}

      {isLoading || !o ? (
        <Skeleton height='20rem' />
      ) : view === 'list' ? (
        <IssueList accountId={accountId} o={o} />
      ) : (
        <Board accountId={accountId} o={o} queryKey={key} />
      )}
      {creating && o && <NewIssueDialog accountId={accountId} o={o} onClose={() => setCreating(false)} />}
    </div>
  )
}

export function StatusIcon({ status }: { status: IssueStatus }) {
  const color =
    status === 'DONE'
      ? 'var(--vhyx-color-success)'
      : status === 'CANCELLED'
        ? 'var(--vhyx-color-text-muted)'
        : status === 'IN_PROGRESS' || status === 'IN_REVIEW'
          ? 'var(--vhyx-color-warning)'
          : 'var(--vhyx-color-text-muted)'

  return (
    <i className={STATUS_ICON[status]} aria-label={STATUS_LABEL[status]} role='img' style={{ color, fontSize: 16 }} />
  )
}

export function PriorityIcon({ priority }: { priority: IssuePriority }) {
  if (priority === 'NONE') return null

  return (
    <i
      className={PRIORITY_ICON[priority]}
      aria-label={`${PRIORITY_LABEL[priority]} priority`}
      role='img'
      style={{
        color: priority === 'URGENT' ? 'var(--vhyx-color-danger)' : 'var(--vhyx-color-text-muted)',
        fontSize: 15
      }}
    />
  )
}

export function Due({ due, closed }: { due: string | null; closed: boolean }) {
  const s = dueState(due, closed)

  if (!due) return null

  return (
    <span
      style={{
        fontSize: 12,
        color:
          s === 'overdue'
            ? 'var(--vhyx-color-danger)'
            : s === 'today' || s === 'soon'
              ? 'var(--vhyx-color-warning)'
              : 'var(--vhyx-color-text-muted)',
        whiteSpace: 'nowrap'
      }}
    >
      <i className='tabler-calendar' aria-hidden /> {s === 'overdue' ? 'Overdue · ' : s === 'today' ? 'Today · ' : ''}
      {new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    </span>
  )
}

function IssueList({ accountId, o }: { accountId: string; o: IssuesOverview }) {
  if (!o.issues.length)
    return (
      <div
        className='flex flex-col items-center gap-2'
        style={{
          ...muted,
          padding: 40,
          textAlign: 'center',
          border: '1px dashed var(--vhyx-color-border)',
          borderRadius: 12
        }}
      >
        <i className='tabler-circle-dot' style={{ fontSize: 32 }} aria-hidden />
        No issues match.
      </div>
    )

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        border: '1px solid var(--vhyx-color-border)',
        borderRadius: 12,
        overflow: 'hidden'
      }}
    >
      {o.issues.map(i => (
        <li key={i.number} style={{ borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
          <Link
            href={`/organizations/${accountId}/team/issues/${i.number}`}
            className='flex items-center gap-3 flex-wrap'
            style={{ padding: '10px 14px', color: 'inherit' }}
          >
            <StatusIcon status={i.status} />
            <span style={{ ...muted, fontSize: 13, minInlineSize: '2.5rem' }}>#{i.number}</span>
            <span
              style={{
                flex: '1 1 14rem',
                minInlineSize: 0,
                fontWeight: 500,
                textDecoration: i.status === 'CANCELLED' ? 'line-through' : undefined
              }}
            >
              {i.title}
            </span>
            {i.labels.map(l => (
              <Badge key={l} size='sm' variant='outline'>
                {l}
              </Badge>
            ))}
            {i.linkCount > 0 && (
              <span style={{ ...muted, fontSize: 12 }} title='Linked objects'>
                <i className='tabler-link' aria-hidden /> {i.linkCount}
              </span>
            )}
            <Due due={i.dueDate} closed={!!i.closedAt} />
            <PriorityIcon priority={i.priority} />
            {i.assignee ? <PersonAvatar name={i.assignee} size='xs' /> : <span style={{ inlineSize: 20 }} />}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Board({ accountId, o, queryKey }: { accountId: string; o: IssuesOverview; queryKey: unknown[] }) {
  const qc = useQueryClient()
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<{ status: IssueStatus; index: number } | null>(null)
  const columns = useMemo(
    () =>
      /\bis:all\b|status:(done|cancelled)/i.test(String(queryKey[3] ?? '')) &&
      o.issues.some(i => i.status === 'CANCELLED')
        ? [...BOARD, 'CANCELLED' as IssueStatus]
        : BOARD,
    [o.issues, queryKey]
  )
  const move = useMutation({
    mutationFn: (m: { number: number; status: IssueStatus; index: number }) => {
      const col = o.issues.filter(i => i.status === m.status).map(i => i.number)

      return teamService.moveIssue(accountId, m.number, { status: m.status, ...dropNeighbours(col, m.number, m.index) })
    },
    onMutate: m => {
      qc.setQueryData(queryKey, (prev: IssuesOverview | undefined) =>
        prev ? { ...prev, issues: moveInColumns(prev.issues, m.number, m.status, m.index) } : prev
      )
    },
    onError: e => toast.danger((e as Error).message),
    onSettled: () => qc.invalidateQueries({ queryKey: teamKeys.issues(accountId) })
  })

  const drop = (status: IssueStatus, index: number) => {
    if (dragging !== null) move.mutate({ number: dragging, status, index })
    setDragging(null)
    setOver(null)
  }

  return (
    <div
      style={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(16rem, 1fr)',
        gap: 12,
        overflowX: 'auto',
        paddingBlockEnd: 8
      }}
    >
      {columns.map(status => {
        const items = o.issues.filter(i => i.status === status)

        return (
          <section
            key={status}
            aria-label={STATUS_LABEL[status]}
            onDragOver={(e: DragEvent) => {
              e.preventDefault()
              if (!over || over.status !== status) setOver({ status, index: items.length })
            }}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              drop(status, over?.status === status ? over.index : items.length)
            }}
            style={{
              background: 'var(--vhyx-color-bg-subtle)',
              border: `1px solid ${over?.status === status ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
              borderRadius: 12,
              padding: 8,
              minBlockSize: 200,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            <header className='flex items-center gap-2' style={{ padding: '2px 4px 6px' }}>
              <StatusIcon status={status} />
              <strong style={{ fontSize: 14 }}>{STATUS_LABEL[status]}</strong>
              <span style={{ ...muted, fontSize: 12 }}>{items.length}</span>
            </header>
            {items.map((i, index) => (
              <BoardCard
                key={i.number}
                accountId={accountId}
                i={i}
                dragging={dragging === i.number}
                showDropBefore={
                  over?.status === status && over.index === index && dragging !== null && dragging !== i.number
                }
                onDragStart={() => setDragging(i.number)}
                onDragEnd={() => (setDragging(null), setOver(null))}
                onDragOverCard={(e: DragEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()

                  setOver({ status, index: e.clientY < box.top + box.height / 2 ? index : index + 1 })
                }}
                onMove={s =>
                  move.mutate({ number: i.number, status: s, index: o.issues.filter(x => x.status === s).length })
                }
                writable={o.enabled}
              />
            ))}
            {over?.status === status && over.index >= items.length && dragging !== null && (
              <div aria-hidden style={{ blockSize: 3, background: 'var(--vhyx-color-accent)', borderRadius: 2 }} />
            )}
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({
  accountId,
  i,
  dragging,
  showDropBefore,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onMove,
  writable
}: {
  accountId: string
  i: IssueSummary
  dragging: boolean
  showDropBefore: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverCard: (e: DragEvent) => void
  onMove: (s: IssueStatus) => void
  writable: boolean
}) {
  return (
    <>
      {showDropBefore && (
        <div aria-hidden style={{ blockSize: 3, background: 'var(--vhyx-color-accent)', borderRadius: 2 }} />
      )}
      <article
        draggable={writable}
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(i.number))
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        onDragOver={onDragOverCard}
        style={{
          background: 'var(--vhyx-color-bg)',
          border: '1px solid var(--vhyx-color-border)',
          borderRadius: 10,
          padding: '8px 10px',
          opacity: dragging ? 0.4 : 1,
          cursor: writable ? 'grab' : 'default'
        }}
      >
        <div className='flex items-start gap-2'>
          <Link
            href={`/organizations/${accountId}/team/issues/${i.number}`}
            style={{ flex: 1, color: 'inherit', fontWeight: 500, fontSize: 14, minInlineSize: 0 }}
          >
            <span style={{ ...muted, fontSize: 12 }}>#{i.number}</span> {i.title}
          </Link>
          {i.assignee && <PersonAvatar name={i.assignee} size='xs' />}
        </div>
        <div className='flex items-center gap-2 flex-wrap' style={{ marginBlockStart: 6 }}>
          <PriorityIcon priority={i.priority} />
          {i.labels.map(l => (
            <Badge key={l} size='sm' variant='outline'>
              {l}
            </Badge>
          ))}
          <Due due={i.dueDate} closed={!!i.closedAt} />
          {writable && (
            <select
              aria-label={`Move #${i.number}`}
              value={i.status}
              onChange={e => onMove(e.target.value as IssueStatus)}
              style={{
                marginInlineStart: 'auto',
                fontSize: 12,
                background: 'transparent',
                color: 'inherit',
                border: '1px solid var(--vhyx-color-border)',
                borderRadius: 6,
                padding: '1px 4px'
              }}
            >
              {ISSUE_STATUSES.map(s => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      </article>
    </>
  )
}

function NewIssueDialog({ accountId, o, onClose }: { accountId: string; o: IssuesOverview; onClose: () => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<IssueStatus>('TODO')
  const [priority, setPriority] = useState<IssuePriority>('NONE')
  const [assignee, setAssignee] = useState('none')
  const [labels, setLabels] = useState('')
  const [due, setDue] = useState('')
  const [link, setLink] = useState('')
  const create = useMutation({
    mutationFn: () =>
      teamService.createIssue(accountId, {
        title: title.trim(),
        body,
        status,
        priority,
        assigneeId: assignee === 'none' ? null : assignee,
        labels: labels
          .split(',')
          .map(l => l.trim())
          .filter(Boolean),
        dueDate: due || null,
        links: link.trim() ? [link.trim()] : []
      }),
    onSuccess: i => {
      qc.invalidateQueries({ queryKey: teamKeys.issues(accountId) })
      toast.success(`Created #${i.number}`)
      router.push(`/organizations/${accountId}/team/issues/${i.number}`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='lg'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>New issue</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (title.trim()) create.mutate()
            }}
          >
            <TextField name='title' label='Title' value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            <TextareaField
              name='body'
              label='Description (Markdown)'
              rows={5}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder='Steps, expected and actual result. Paste dashboard links to endpoints, requests or runs.'
            />
            <div
              className='grid gap-3'
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 12rem), 1fr))' }}
            >
              <SelectField
                name='status'
                label='Status'
                value={status}
                onValueChange={v => setStatus(v as IssueStatus)}
                options={ISSUE_STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))}
              />
              <SelectField
                name='priority'
                label='Priority'
                value={priority}
                onValueChange={v => setPriority(v as IssuePriority)}
                options={ISSUE_PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
              <SelectField
                name='assignee'
                label='Assignee'
                value={assignee}
                onValueChange={setAssignee}
                options={[
                  { value: 'none', label: 'Nobody' },
                  ...o.people.map(p => ({ value: p.id, label: p.id === o.me ? `${p.name} (me)` : p.name }))
                ]}
              />
              <TextField name='due' label='Due date' type='date' value={due} onChange={e => setDue(e.target.value)} />
            </div>
            <TextField
              name='labels'
              label='Labels (comma-separated)'
              value={labels}
              onChange={e => setLabels(e.target.value)}
              placeholder='bug, auth'
              hint={o.labels.length ? `In use: ${o.labels.slice(0, 10).join(', ')}` : undefined}
            />
            <TextField
              name='link'
              label='Link an object (optional)'
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder='Paste a dashboard link: a mock endpoint, a request, a load test run…'
            />
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={create.isPending} disabled={!title.trim()}>
                Create
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
