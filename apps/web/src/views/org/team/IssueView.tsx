'use client'

// One issue: title and description, its fields in a side column, linked
// objects as cards, and one feed of changes and comments.

import { useMemo, useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Button, Input, SelectField, Skeleton, TextField, toast } from '@vhyxui/react'

import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  teamKeys,
  teamService,
  type Issue,
  type IssueEvent,
  type IssueInput,
  type IssuePriority,
  type IssueStatus
} from '@/api/infrastructure/services/team.service'
import { CommentItem } from './DocView'
import {
  CardList,
  Composer,
  LiveDot,
  MentionTextarea,
  RICH_CSS,
  RichText,
  ShareToChatButton,
  muted,
  usePeople,
  useTeamSocket
} from './TeamParts'
import { PRIORITY_LABEL, STATUS_LABEL, dayLabel, timeLabel, toEditable, toStored } from './teamForm'
import { Due, StatusIcon } from './IssuesView'

export default function IssueView({ accountId, number }: { accountId: string; number: number }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const router = useRouter()
  const {
    data: i,
    error,
    isLoading
  } = useQuery({
    queryKey: teamKeys.issue(accountId, number),
    queryFn: () => teamService.issue(accountId, number),
    enabled: ready
  })
  const people = usePeople(accountId, ready)
  const me = useQuery({
    queryKey: teamKeys.chat(accountId),
    queryFn: () => teamService.chat(accountId),
    enabled: ready
  }).data?.me
  const socket = useTeamSocket(accountId, ready && !!i?.writable)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [link, setLink] = useState('')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: teamKeys.issue(accountId, number) })
    qc.invalidateQueries({ queryKey: teamKeys.issues(accountId) })
  }
  const patch = useMutation({
    mutationFn: (data: IssueInput) => teamService.updateIssue(accountId, number, data),
    onSuccess: refresh,
    onError: e => toast.danger((e as Error).message)
  })
  const remove = useMutation({
    mutationFn: () => teamService.deleteIssue(accountId, number),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamKeys.issues(accountId) })
      router.push(`/organizations/${accountId}/team/issues`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  const feed = useMemo(() => {
    if (!i) return []
    const items: Array<{ at: string; event?: IssueEvent; comment?: Issue['comments'][number] }> = [
      ...i.events.filter(e => e.kind !== 'comment').map(e => ({ at: e.createdAt, event: e })),
      ...i.comments.filter(c => !c.deleted).map(c => ({ at: c.createdAt, comment: c }))
    ]

    return items.sort((a, b) => a.at.localeCompare(b.at))
  }, [i])

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !i) return <Skeleton height='24rem' />

  const w = i.writable
  const closed = i.status === 'DONE' || i.status === 'CANCELLED'

  return (
    <div className='flex flex-col gap-4'>
      <style>{`${RICH_CSS}
.vv-issue { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1000px) { .vv-issue { grid-template-columns: minmax(0, 1fr) 17rem; } }`}</style>
      <nav style={{ ...muted, fontSize: 13 }} aria-label='Breadcrumb' className='flex items-center gap-2'>
        <Link href={`/organizations/${accountId}/team/issues`}>Issues</Link> / #{i.number}
        {w && <LiveDot status={socket.status} />}
      </nav>
      <div className='flex items-start gap-3 flex-wrap'>
        <StatusIcon status={i.status} />
        <input
          aria-label='Title'
          value={title ?? i.title}
          readOnly={!w}
          onChange={e => setTitle(e.target.value)}
          onBlur={() =>
            title !== null &&
            title.trim() &&
            title !== i.title &&
            patch.mutate({ title: title.trim() }, { onSettled: () => setTitle(null) })
          }
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{
            flex: '1 1 20rem',
            minInlineSize: 0,
            fontSize: 24,
            fontWeight: 700,
            border: 0,
            background: 'transparent',
            color: 'inherit',
            outline: 'none',
            padding: 0,
            textDecoration: i.status === 'CANCELLED' ? 'line-through' : undefined
          }}
        />
        <ShareToChatButton accountId={accountId} path={`/organizations/${accountId}/team/issues/${i.number}`} />
      </div>
      <span style={{ ...muted, fontSize: 13 }}>
        Opened by {i.createdBy ?? 'someone'} {dayLabel(i.createdAt).toLowerCase()}
        {i.closedAt ? ` · closed ${dayLabel(i.closedAt).toLowerCase()}` : ''}
      </span>

      <div className='vv-issue'>
        <div className='flex flex-col gap-4' style={{ minInlineSize: 0 }}>
          <section>
            {editing ? (
              <div className='flex flex-col gap-2'>
                <MentionTextarea
                  label='Description'
                  value={draft}
                  onChange={setDraft}
                  onPick={(n, id) => setPicked(p => ({ ...p, [n]: id }))}
                  people={people}
                  me={me}
                  rows={10}
                />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    onClick={() =>
                      patch.mutate({ body: toStored(draft, picked) }, { onSuccess: () => setEditing(false) })
                    }
                    loading={patch.isPending}
                  >
                    Save
                  </Button>
                  <Button size='sm' variant='secondary' onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className='flex flex-col gap-2'>
                {i.body ? (
                  <RichText text={i.body} people={people} me={me} />
                ) : (
                  <span style={muted}>No description.</span>
                )}
                {w && (
                  <div>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => {
                        const e = toEditable(i.body, people)

                        setDraft(e.text)
                        setPicked(e.picked)
                        setEditing(true)
                      }}
                      icon={<i className='tabler-pencil' />}
                    >
                      Edit description
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className='flex flex-col gap-2'>
            <strong style={{ fontSize: 14 }}>Linked</strong>
            {i.links.length === 0 && (
              <span style={{ ...muted, fontSize: 13 }}>
                Nothing linked yet. Link the endpoint, request, run or doc this is about.
              </span>
            )}
            <CardList
              cards={i.links.map(
                l => l.card ?? { kind: 'link', href: l.url, title: l.url, subtitle: 'Link', missing: true }
              )}
              onRemove={
                w
                  ? idx =>
                      patch.mutate({
                        links: i.links
                          .filter((_, j) => j !== idx)
                          .map(l => l.url)
                          .filter(u => !i.body.includes(u))
                      })
                  : undefined
              }
            />
            {w && (
              <form
                className='flex gap-2'
                onSubmit={e => {
                  e.preventDefault()
                  if (!link.trim()) return
                  patch.mutate(
                    { links: [...i.links.map(l => l.url).filter(u => !i.body.includes(u)), link.trim()] },
                    { onSuccess: () => setLink('') }
                  )
                }}
              >
                <Input
                  size='sm'
                  value={link}
                  onChange={e => setLink(e.target.value)}
                  placeholder='Paste a dashboard link to link it'
                  aria-label='Link an object'
                  style={{ flex: 1 }}
                />
                <Button size='sm' variant='outline' type='submit' disabled={!link.trim()}>
                  Link
                </Button>
              </form>
            )}
          </section>

          <section className='flex flex-col gap-3' aria-label='Activity'>
            <strong style={{ fontSize: 14 }}>Activity</strong>
            {feed.map(x =>
              x.comment ? (
                <CommentItem
                  key={x.comment.id}
                  accountId={accountId}
                  c={x.comment}
                  people={people}
                  me={me}
                  onChanged={refresh}
                  resolvable={false}
                />
              ) : (
                <div key={x.event!.id} style={{ ...muted, fontSize: 13 }} className='flex items-center gap-2'>
                  <i className='tabler-point-filled' aria-hidden />
                  <span>
                    <strong style={{ color: 'var(--vhyx-color-text)' }}>{x.event!.actor ?? 'Someone'}</strong>{' '}
                    {describe(x.event!)} · {dayLabel(x.at).toLowerCase()} {timeLabel(x.at)}
                  </span>
                </div>
              )
            )}
            {w && (
              <Composer
                people={people}
                me={me}
                label='Comment'
                placeholder='Comment, or @mention someone'
                enterSends={false}
                minRows={2}
                submitLabel='Comment'
                onSubmit={async body => {
                  try {
                    await teamService.comment(accountId, { target: `issue:${number}`, body })
                    refresh()

                    return true
                  } catch (e) {
                    toast.danger((e as Error).message)

                    return false
                  }
                }}
              />
            )}
          </section>
        </div>

        <aside className='flex flex-col gap-3' aria-label='Fields'>
          <SelectField
            name='status'
            label='Status'
            value={i.status}
            disabled={!w}
            onValueChange={v => patch.mutate({ status: v as IssueStatus })}
            options={ISSUE_STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }))}
          />
          <SelectField
            name='priority'
            label='Priority'
            value={i.priority}
            disabled={!w}
            onValueChange={v => patch.mutate({ priority: v as IssuePriority })}
            options={ISSUE_PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
          />
          <SelectField
            name='assignee'
            label='Assignee'
            value={i.assigneeId ?? 'none'}
            disabled={!w}
            onValueChange={v => patch.mutate({ assigneeId: v === 'none' ? null : v })}
            options={[
              { value: 'none', label: 'Nobody' },
              ...people.map(p => ({ value: p.id, label: p.id === me ? `${p.name} (me)` : p.name }))
            ]}
          />
          {w && i.assigneeId !== me && me && (
            <Button size='sm' variant='ghost' onClick={() => patch.mutate({ assigneeId: me })}>
              Assign to me
            </Button>
          )}
          <LabelsField labels={i.labels} disabled={!w} onSave={labels => patch.mutate({ labels })} />
          <TextField
            name='due'
            label='Due date'
            type='date'
            value={i.dueDate ?? ''}
            disabled={!w}
            onChange={e => patch.mutate({ dueDate: e.target.value || null })}
          />
          <Due due={i.dueDate} closed={closed} />
          {i.canDelete && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => window.confirm(`Delete #${i.number}? Its comments go too.`) && remove.mutate()}
            >
              Delete issue
            </Button>
          )}
        </aside>
      </div>
    </div>
  )
}

function LabelsField({
  labels,
  disabled,
  onSave
}: {
  labels: string[]
  disabled: boolean
  onSave: (l: string[]) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const value = text ?? labels.join(', ')

  return (
    <TextField
      name='labels'
      label='Labels'
      value={value}
      disabled={disabled}
      hint='Comma-separated'
      onChange={e => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return
        const next = text
          .split(',')
          .map(l => l.trim().toLowerCase())
          .filter(Boolean)

        if (next.join(',') !== labels.join(',')) onSave(next)
        setText(null)
      }}
    />
  )
}

function describe(e: IssueEvent): string {
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? 'none' : String(x))

  switch (e.kind) {
    case 'created':
      return 'opened this issue'
    case 'status':
      return `moved it from ${STATUS_LABEL[e.from as IssueStatus] ?? v(e.from)} to ${STATUS_LABEL[e.to as IssueStatus] ?? v(e.to)}`
    case 'assignee':
      return e.to ? `assigned it to ${e.toName ?? 'someone'}` : `unassigned ${e.fromName ?? 'it'}`
    case 'priority':
      return `set the priority to ${PRIORITY_LABEL[e.to as IssuePriority] ?? v(e.to)}`
    case 'labels':
      return `set the labels to ${Array.isArray(e.to) && e.to.length ? e.to.join(', ') : 'none'}`
    case 'due':
      return e.to ? `set the due date to ${v(e.to)}` : 'removed the due date'
    case 'title':
      return `renamed it from “${v(e.from)}”`
    case 'body':
      return 'edited the description'
    case 'links':
      return `changed the linked objects (${v(e.to)})`
    default:
      return e.kind
  }
}
