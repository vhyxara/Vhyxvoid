'use client'

// Team chat: channels and direct messages on the left, the conversation in
// the middle, a thread on the right. The channel and thread are in the URL
// (?c=…&thread=…) so notifications and shared links open them.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Checkbox, Dialog, Input, Skeleton, Switch, TextField, toast } from '@vhyxui/react'

import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import {
  teamKeys,
  teamService,
  type ChannelSummary,
  type ChatMessage,
  type ChatOverview,
  type Person
} from '@/api/infrastructure/services/team.service'
import {
  CardList,
  Composer,
  LiveDot,
  PersonAvatar,
  RICH_CSS,
  RichText,
  muted,
  useTeamSocket,
  type ComposerHandle
} from './TeamParts'
import { QUICK_REACTIONS, dayLabel, groupedWithPrevious, timeLabel, toEditable } from './teamForm'

const CSS = `
${RICH_CSS}
.vv-chat { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; border: 1px solid var(--vhyx-color-border); border-radius: 12px; overflow: hidden; block-size: calc(100vh - 170px); min-block-size: 480px; background: var(--vhyx-color-bg); }
.vv-chat-side, .vv-chat-main, .vv-chat-thread { min-inline-size: 0; min-block-size: 0; display: flex; flex-direction: column; }
.vv-chat-side { border-inline-end: 1px solid var(--vhyx-color-border); background: var(--vhyx-color-bg-subtle); }
.vv-chat-thread { border-inline-start: 1px solid var(--vhyx-color-border); }
.vv-chat[data-pane="list"] .vv-chat-main, .vv-chat[data-pane="list"] .vv-chat-thread { display: none; }
.vv-chat[data-pane="channel"] .vv-chat-side, .vv-chat[data-pane="channel"] .vv-chat-thread { display: none; }
.vv-chat[data-pane="thread"] .vv-chat-side, .vv-chat[data-pane="thread"] .vv-chat-main { display: none; }
.vv-back { display: inline-flex; }
@media (min-width: 900px) {
  .vv-chat { grid-template-columns: 15rem minmax(0, 1fr); }
  .vv-chat[data-thread="1"] { grid-template-columns: 15rem minmax(0, 1fr) 22rem; }
  .vv-chat .vv-chat-side, .vv-chat .vv-chat-main { display: flex !important; }
  .vv-chat[data-thread="1"] .vv-chat-thread { display: flex !important; }
  .vv-chat[data-thread="0"] .vv-chat-thread { display: none !important; }
  .vv-back { display: none; }
}
.vv-msg { position: relative; padding: 4px 16px; }
.vv-msg:hover, .vv-msg:focus-within { background: var(--vhyx-color-bg-subtle); }
.vv-msg-actions { position: absolute; inset-block-start: -12px; inset-inline-end: 16px; display: none; gap: 2px; background: var(--vhyx-color-surface, var(--vhyx-color-bg)); border: 1px solid var(--vhyx-color-border); border-radius: 8px; padding: 2px; z-index: 5; }
.vv-msg:hover .vv-msg-actions, .vv-msg:focus-within .vv-msg-actions { display: flex; }
.vv-chan { display: flex; align-items: center; gap: 6px; inline-size: 100%; text-align: start; background: none; border: 0; border-radius: 6px; padding: 5px 8px; color: inherit; cursor: pointer; font-size: 14px; }
.vv-chan:hover { background: var(--vhyx-color-bg-muted); }
.vv-chan[aria-current="true"] { background: var(--vhyx-color-accent-subtle, rgba(124,58,237,.15)); font-weight: 600; }
.vv-chan[data-unread="1"] { font-weight: 700; }
`

export default function ChatView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const {
    data: o,
    isLoading,
    error
  } = useQuery({ queryKey: teamKeys.chat(accountId), queryFn: () => teamService.chat(accountId), enabled: ready })
  const socket = useTeamSocket(accountId, ready && !!o?.enabled)
  const cid = params.get('c')
  const thread = params.get('thread')
  const [pane, setPane] = useState<'list' | 'channel' | 'thread'>(thread ? 'thread' : cid ? 'channel' : 'list')
  const [dialog, setDialog] = useState<'channel' | 'dm' | 'search' | 'settings' | null>(
    params.get('settings') ? 'settings' : null
  )

  const go = useCallback(
    (c: string | null, t: string | null = null) => {
      const q = new URLSearchParams()

      if (c) q.set('c', c)
      if (t) q.set('thread', t)
      router.replace(`?${q.toString()}`, { scroll: false })
      setPane(t ? 'thread' : c ? 'channel' : 'list')
    },
    [router]
  )

  // Open #general (or the first channel) when nothing is chosen, on wide screens.
  useEffect(() => {
    if (!o || cid) return
    const first = o.channels.find(c => c.name === 'general') ?? o.channels[0]

    if (first && window.matchMedia('(min-width: 900px)').matches) go(first.id)
  }, [o, cid, go])

  const current = o?.channels.find(c => c.id === cid) ?? null

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !o) return <Skeleton height='30rem' />

  return (
    <div className='flex flex-col gap-3'>
      <style>{CSS}</style>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <div className='flex items-center gap-3'>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Chat</h1>
          {o.enabled && <LiveDot status={socket.status} />}
        </div>
        <div className='flex items-center gap-2'>
          <Button size='sm' variant='ghost' onClick={() => setDialog('search')} icon={<i className='tabler-search' />}>
            Search
          </Button>
          <Link href={`/organizations/${accountId}/team/docs`}>
            <Button size='sm' variant='ghost' icon={<i className='tabler-file-text' />}>
              Docs
            </Button>
          </Link>
          <Link href={`/organizations/${accountId}/team/issues`}>
            <Button size='sm' variant='ghost' icon={<i className='tabler-circle-dot' />}>
              Issues
            </Button>
          </Link>
          <Button size='sm' variant='ghost' onClick={() => setDialog('settings')} aria-label='Notification settings'>
            <i className='tabler-settings' aria-hidden />
          </Button>
        </div>
      </div>

      {!o.platformEnabled ? (
        <Alert variant='info'>
          The team space is switched off on this platform right now. You can read, but not write.
        </Alert>
      ) : !o.enabled ? (
        <Alert variant='info' title='Not on this plan'>
          <Link href={`/organizations/${accountId}/billing`}>See plans</Link> to use the team space.
        </Alert>
      ) : null}

      <div className='vv-chat' data-pane={pane} data-thread={thread ? '1' : '0'}>
        <ChannelList
          o={o}
          current={cid}
          onOpen={id => go(id)}
          onNew={() => setDialog('channel')}
          onDm={() => setDialog('dm')}
        />
        <div className='vv-chat-main'>
          {current ? (
            <Conversation
              key={current.id}
              accountId={accountId}
              o={o}
              channel={current}
              onBack={() => go(null)}
              onThread={mid => go(current.id, mid)}
              subscribe={socket.subscribe}
              writable={o.enabled && !current.archived}
            />
          ) : (
            <div
              className='flex flex-col items-center justify-center gap-2'
              style={{ flex: 1, ...muted, padding: 24, textAlign: 'center' }}
            >
              <i className='tabler-messages' style={{ fontSize: 36 }} aria-hidden />
              {cid ? 'This channel is gone, or you are not in it.' : 'Pick a channel or start a direct message.'}
            </div>
          )}
        </div>
        <div className='vv-chat-thread'>
          {thread && current && (
            <Thread
              key={thread}
              accountId={accountId}
              o={o}
              channel={current}
              rootId={thread}
              onClose={() => go(current.id)}
              subscribe={socket.subscribe}
              writable={o.enabled && !current.archived}
            />
          )}
        </div>
      </div>

      {dialog === 'channel' && (
        <NewChannelDialog
          accountId={accountId}
          o={o}
          onClose={() => setDialog(null)}
          onCreated={id => (setDialog(null), go(id))}
        />
      )}
      {dialog === 'dm' && (
        <NewDmDialog
          accountId={accountId}
          o={o}
          onClose={() => setDialog(null)}
          onOpened={id => (setDialog(null), qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) }), go(id))}
        />
      )}
      {dialog === 'search' && (
        <SearchDialog
          accountId={accountId}
          onClose={() => setDialog(null)}
          onMessage={(c, t) => (setDialog(null), go(c, t))}
        />
      )}
      {dialog === 'settings' && <SettingsDialog accountId={accountId} onClose={() => setDialog(null)} />}
    </div>
  )
}

function ChannelList({
  o,
  current,
  onOpen,
  onNew,
  onDm
}: {
  o: ChatOverview
  current: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onDm: () => void
}) {
  const [browse, setBrowse] = useState(false)
  const channels = o.channels.filter(c => c.kind === 'CHANNEL' && !c.archived && (c.joined || c.isPrivate))
  const others = o.channels.filter(c => c.kind === 'CHANNEL' && !c.joined && !c.isPrivate && !c.archived)
  const archived = o.channels.filter(c => c.kind === 'CHANNEL' && c.archived)
  const dms = o.channels
    .filter(c => c.kind === 'DM')
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))

  const item = (c: ChannelSummary) => (
    <li key={c.id}>
      <button
        type='button'
        className='vv-chan'
        aria-current={c.id === current}
        data-unread={c.unread ? '1' : '0'}
        onClick={() => onOpen(c.id)}
      >
        <i
          className={c.kind === 'DM' ? 'tabler-user' : c.isPrivate ? 'tabler-lock' : 'tabler-hash'}
          aria-hidden
          style={{ fontSize: 15, ...muted }}
        />
        <span style={{ flex: 1, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.name}
        </span>
        {c.mentions > 0 ? (
          <Badge size='sm' variant='danger' aria-label={`${c.mentions} mentions`}>
            @{c.mentions}
          </Badge>
        ) : c.unread > 0 ? (
          <Badge size='sm' variant='info' aria-label={`${c.unread} unread`}>
            {c.unread}
          </Badge>
        ) : null}
      </button>
    </li>
  )

  const section = (title: string, action: React.ReactNode, items: ChannelSummary[]) => (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center justify-between' style={{ padding: '0 8px' }}>
        <span style={{ ...muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </span>
        {action}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{items.map(item)}</ul>
    </div>
  )

  return (
    <nav className='vv-chat-side' aria-label='Channels' style={{ overflowY: 'auto', padding: '12px 6px', gap: 16 }}>
      {section(
        'Channels',
        o.enabled && (
          <Button size='sm' variant='ghost' onClick={onNew} aria-label='New channel'>
            <i className='tabler-plus' aria-hidden />
          </Button>
        ),
        channels
      )}
      {others.length > 0 && (
        <div style={{ padding: '0 8px' }}>
          <button
            type='button'
            onClick={() => setBrowse(b => !b)}
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              color: 'var(--vhyx-color-accent)',
              cursor: 'pointer',
              fontSize: 13
            }}
            aria-expanded={browse}
          >
            {browse ? 'Hide' : 'Browse'} {others.length} more channel{others.length === 1 ? '' : 's'}
          </button>
          {browse && <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>{others.map(item)}</ul>}
        </div>
      )}
      {section(
        'Direct messages',
        o.enabled && (
          <Button size='sm' variant='ghost' onClick={onDm} aria-label='New direct message'>
            <i className='tabler-plus' aria-hidden />
          </Button>
        ),
        dms
      )}
      {archived.length > 0 && section('Archived', null, archived)}
    </nav>
  )
}

// ── Conversation ────────────────────────────────────────────────────────────

type Sub = (l: (e: { kind: string; payload: Record<string, unknown> }) => void) => () => void

function useTyping(subscribe: Sub, channelId: string, parentId: string | null, me: string) {
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})

  useEffect(
    () =>
      subscribe(e => {
        if (
          e.kind === 'typing' &&
          e.payload.channelId === channelId &&
          (e.payload.parentId ?? null) === parentId &&
          e.payload.userId !== me
        ) {
          setTyping(t => ({
            ...t,
            [String(e.payload.userId)]: { name: String(e.payload.name ?? 'Someone'), until: Date.now() + 5000 }
          }))
        }

        if (e.kind === 'message' && (e.payload.message as ChatMessage | undefined)?.authorId) {
          const author = (e.payload.message as ChatMessage).authorId

          setTyping(t => {
            const n = { ...t }

            delete n[author]

            return n
          })
        }
      }),
    [subscribe, channelId, parentId, me]
  )
  useEffect(() => {
    const t = setInterval(
      () => setTyping(x => Object.fromEntries(Object.entries(x).filter(([, v]) => v.until > Date.now()))),
      1000
    )

    return () => clearInterval(t)
  }, [])
  const names = Object.values(typing).map(t => t.name)

  return names.length ? `${names.slice(0, 3).join(', ')} ${names.length === 1 ? 'is' : 'are'} typing…` : ''
}

function Conversation({
  accountId,
  o,
  channel,
  onBack,
  onThread,
  subscribe,
  writable
}: {
  accountId: string
  o: ChatOverview
  channel: ChannelSummary
  onBack: () => void
  onThread: (mid: string) => void
  subscribe: Sub
  writable: boolean
}) {
  const qc = useQueryClient()
  const list = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [readMarker, setReadMarker] = useState<string | null | undefined>(undefined)
  const typing = useTyping(subscribe, channel.id, null, o.me)

  const pages = useInfiniteQuery({
    queryKey: teamKeys.messages(accountId, channel.id),
    queryFn: ({ pageParam }) => teamService.messages(accountId, channel.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => (last.hasMore ? last.messages[0]?.createdAt : undefined)
  })
  const messages = useMemo(
    () =>
      (pages.data?.pages ?? [])
        .slice()
        .reverse()
        .flatMap(p => p.messages),
    [pages.data]
  )
  const first = pages.data?.pages[0]
  const hidden = pages.data?.pages[pages.data.pages.length - 1]?.hiddenByPlan ?? 0

  // Remember where unread began (for the "New" divider), then mark read.
  useEffect(() => {
    if (first && readMarker === undefined) setReadMarker(first.lastReadAt)
  }, [first, readMarker])

  const markRead = useMutation({
    mutationFn: () => teamService.read(accountId, channel.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) })
  })
  const lastId = messages[messages.length - 1]?.id

  useEffect(() => {
    if (!lastId || document.hidden) return
    const t = setTimeout(() => markRead.mutate(), 600)

    return () => clearTimeout(t)
  }, [lastId])

  // Stick to the bottom when new messages arrive and we were near it.
  const nearBottom = useRef(true)

  useEffect(() => {
    const el = list.current

    if (el && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, lastId])

  const send = async (body: string) => {
    try {
      if (editing) {
        await teamService.edit(accountId, editing.id, body)
        setEditing(null)
      } else {
        await teamService.send(accountId, channel.id, body)
        nearBottom.current = true
      }

      qc.invalidateQueries({ queryKey: teamKeys.messages(accountId, channel.id) })

      return true
    } catch (e) {
      toast.danger((e as Error).message)

      return false
    }
  }

  const join = useMutation({
    mutationFn: () => teamService.join(accountId, channel.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) })
  })
  const leave = useMutation({
    mutationFn: () => teamService.leave(accountId, channel.id),
    onSuccess: () => (qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) }), onBack())
  })
  const [settings, setSettings] = useState(false)
  const members = channel.memberIds ? o.people.filter(p => channel.memberIds!.includes(p.id)) : null

  return (
    <>
      <header
        className='flex items-center gap-2'
        style={{ padding: '10px 16px', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}
      >
        <Button className='vv-back' size='sm' variant='ghost' onClick={onBack} aria-label='Back to channels'>
          <i className='tabler-arrow-left' aria-hidden />
        </Button>
        <div className='flex flex-col' style={{ minInlineSize: 0, flex: 1 }}>
          <strong style={{ fontSize: 15 }}>
            {channel.kind === 'DM' ? channel.name : `${channel.isPrivate ? '🔒 ' : '#'}${channel.name}`}
            {channel.archived && (
              <Badge size='sm' variant='warning' style={{ marginInlineStart: 6 }}>
                archived
              </Badge>
            )}
          </strong>
          {(channel.topic || members) && (
            <span
              style={{ ...muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {channel.topic}
              {channel.topic && members ? ' · ' : ''}
              {members ? `${members.length} member${members.length === 1 ? '' : 's'}` : ''}
            </span>
          )}
        </div>
        {channel.kind === 'CHANNEL' && !channel.joined && !channel.isPrivate && writable && (
          <Button size='sm' onClick={() => join.mutate()} loading={join.isPending}>
            Join
          </Button>
        )}
        {channel.kind === 'CHANNEL' && (
          <Button size='sm' variant='ghost' onClick={() => setSettings(true)} aria-label='Channel settings'>
            <i className='tabler-dots' aria-hidden />
          </Button>
        )}
      </header>

      <div
        ref={list}
        role='log'
        aria-label={`Messages in ${channel.name}`}
        aria-live='polite'
        onScroll={e => {
          const el = e.currentTarget

          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        style={{ flex: 1, overflowY: 'auto', paddingBlock: 12 }}
      >
        {pages.hasNextPage ? (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <Button size='sm' variant='ghost' onClick={() => pages.fetchNextPage()} loading={pages.isFetchingNextPage}>
              Load older messages
            </Button>
          </div>
        ) : hidden > 0 ? (
          <Alert variant='info' style={{ margin: '0 16px 8px' }}>
            {hidden} older message{hidden === 1 ? ' is' : 's are'} beyond your plan’s chat history. They are kept;{' '}
            <Link href={`/organizations/${accountId}/billing`}>upgrade</Link> to see them.
          </Alert>
        ) : messages.length > 0 ? (
          <p style={{ ...muted, fontSize: 13, textAlign: 'center' }}>
            This is the start of {channel.kind === 'DM' ? 'your conversation' : `#${channel.name}`}.
          </p>
        ) : null}
        {pages.isLoading && <Skeleton height='10rem' style={{ margin: 16 }} />}
        {!pages.isLoading && messages.length === 0 && (
          <div className='flex flex-col items-center gap-1' style={{ ...muted, padding: 32, textAlign: 'center' }}>
            <i className='tabler-message-circle' style={{ fontSize: 30 }} aria-hidden />
            Nothing here yet. Say hello, or paste a link to a mock, request, run or document.
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
          const unreadStart =
            readMarker &&
            m.authorId !== o.me &&
            new Date(m.createdAt) > new Date(readMarker) &&
            (!prev || new Date(prev.createdAt) <= new Date(readMarker))

          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider label={dayLabel(m.createdAt)} />}
              {unreadStart && <DayDivider label='New' accent />}
              <MessageRow
                accountId={accountId}
                m={m}
                people={o.people}
                me={o.me}
                canModerate={o.canManage}
                grouped={!newDay && !unreadStart && groupedWithPrevious(prev, m)}
                onReply={() => onThread(m.id)}
                onEdit={() => {
                  setEditing(m)
                  const e = toEditable(m.body, o.people)

                  composer.current?.set(e.text, e.picked)
                }}
                writable={writable}
              />
            </Fragment>
          )
        })}
      </div>

      <div style={{ padding: '8px 16px 12px' }}>
        <div style={{ ...muted, fontSize: 12, minBlockSize: 16 }} aria-live='polite'>
          {typing}
        </div>
        {editing && (
          <div className='flex items-center justify-between' style={{ fontSize: 12, ...muted }}>
            Editing a message
            <Button size='sm' variant='link' onClick={() => (setEditing(null), composer.current?.set(''))}>
              Cancel
            </Button>
          </div>
        )}
        {writable ? (
          <Composer
            ref={composer}
            people={o.people}
            me={o.me}
            label={`Message ${channel.name}`}
            placeholder={channel.kind === 'DM' ? `Message ${channel.name}` : `Message #${channel.name}`}
            onSubmit={send}
            onTyping={() => void teamService.typing(accountId, channel.id).catch(() => undefined)}
            onEscape={() => editing && (setEditing(null), composer.current?.set(''))}
            submitLabel={editing ? 'Save' : 'Send'}
          />
        ) : (
          <Alert variant='info'>{channel.archived ? 'This channel is archived.' : 'Read-only right now.'}</Alert>
        )}
      </div>

      {settings && (
        <ChannelSettings
          accountId={accountId}
          o={o}
          channel={channel}
          onClose={() => setSettings(false)}
          onLeave={() => leave.mutate()}
        />
      )}
    </>
  )
}

function DayDivider({ label, accent }: { label: string; accent?: boolean }) {
  const color = accent ? 'var(--vhyx-color-danger)' : 'var(--vhyx-color-border)'

  return (
    <div className='flex items-center gap-2' style={{ padding: '8px 16px' }} role='separator' aria-label={label}>
      <span style={{ flex: 1, blockSize: 1, background: color }} />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: accent ? 'var(--vhyx-color-danger)' : 'var(--vhyx-color-text-muted)'
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, blockSize: 1, background: color }} />
    </div>
  )
}

function MessageRow({
  accountId,
  m,
  people,
  me,
  canModerate,
  grouped,
  onReply,
  onEdit,
  writable,
  inThread
}: {
  accountId: string
  m: ChatMessage
  people: Person[]
  me: string
  canModerate: boolean
  grouped: boolean
  onReply?: () => void
  onEdit: () => void
  writable: boolean
  inThread?: boolean
}) {
  const qc = useQueryClient()
  const [picker, setPicker] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: teamKeys.messages(accountId, m.channelId) })
    qc.invalidateQueries({ queryKey: teamKeys.thread(accountId, m.parentId ?? m.id) })
  }
  const react = async (emoji: string) => {
    setPicker(false)

    try {
      await teamService.react(accountId, m.id, emoji)
      refresh()
    } catch (e) {
      toast.danger((e as Error).message)
    }
  }
  const remove = async () => {
    if (!window.confirm('Delete this message?')) return

    try {
      await teamService.remove(accountId, m.id)
      refresh()
    } catch (e) {
      toast.danger((e as Error).message)
    }
  }
  const copyLink = () => {
    const url = `${window.location.origin}/organizations/${accountId}/team/chat?c=${m.channelId}${m.parentId ? `&thread=${m.parentId}` : `&thread=${m.id}`}`

    navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))
  }

  return (
    <div className='vv-msg' style={{ paddingBlockStart: grouped ? 2 : 8 }} tabIndex={-1}>
      <div className='flex gap-3'>
        <div style={{ inlineSize: 32, flex: 'none' }}>{!grouped && <PersonAvatar name={m.authorName} />}</div>
        <div style={{ minInlineSize: 0, flex: 1 }}>
          {!grouped && (
            <div className='flex items-baseline gap-2'>
              <strong style={{ fontSize: 14 }}>{m.authorName}</strong>
              <time dateTime={m.createdAt} style={{ ...muted, fontSize: 12 }}>
                {timeLabel(m.createdAt)}
              </time>
            </div>
          )}
          {m.deleted ? (
            <span style={{ ...muted, fontStyle: 'italic', fontSize: 14 }}>This message was deleted.</span>
          ) : (
            <>
              <RichText text={m.body} people={people} me={me} compact />
              {m.editedAt && <span style={{ ...muted, fontSize: 11 }}> (edited)</span>}
              <CardList cards={m.cards} />
            </>
          )}
          {m.reactions.length > 0 && (
            <div className='flex gap-1 flex-wrap' style={{ marginBlockStart: 4 }}>
              {m.reactions.map(r => (
                <button
                  key={r.emoji}
                  type='button'
                  onClick={() => writable && react(r.emoji)}
                  aria-pressed={r.mine}
                  title={r.users.map(u => people.find(p => p.id === u)?.name ?? 'Someone').join(', ')}
                  style={{
                    border: `1px solid ${r.mine ? 'var(--vhyx-color-accent)' : 'var(--vhyx-color-border)'}`,
                    background: r.mine ? 'var(--vhyx-color-accent-subtle, rgba(124,58,237,.12))' : 'transparent',
                    borderRadius: 999,
                    padding: '0 8px',
                    fontSize: 13,
                    color: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
            </div>
          )}
          {!inThread && m.replyCount > 0 && (
            <button
              type='button'
              onClick={onReply}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                marginBlockStart: 4,
                color: 'var(--vhyx-color-accent)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              {m.replyCount} repl{m.replyCount === 1 ? 'y' : 'ies'}
              {m.lastReplyAt ? (
                <span style={{ ...muted, fontWeight: 400 }}> · last {timeLabel(m.lastReplyAt)}</span>
              ) : null}
            </button>
          )}
        </div>
      </div>
      {!m.deleted && (
        <div className='vv-msg-actions' role='toolbar' aria-label='Message actions'>
          {writable && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setPicker(p => !p)}
              aria-label='Add a reaction'
              aria-expanded={picker}
            >
              <i className='tabler-mood-plus' aria-hidden />
            </Button>
          )}
          {!inThread && onReply && writable && (
            <Button size='sm' variant='ghost' onClick={onReply} aria-label='Reply in thread'>
              <i className='tabler-message-reply' aria-hidden />
            </Button>
          )}
          {m.authorId === me && writable && (
            <Button size='sm' variant='ghost' onClick={onEdit} aria-label='Edit'>
              <i className='tabler-pencil' aria-hidden />
            </Button>
          )}
          <Button size='sm' variant='ghost' onClick={copyLink} aria-label='Copy link'>
            <i className='tabler-link' aria-hidden />
          </Button>
          {(m.authorId === me || canModerate) && (
            <Button size='sm' variant='ghost' onClick={remove} aria-label='Delete'>
              <i className='tabler-trash' aria-hidden />
            </Button>
          )}
          {picker && (
            <div
              className='flex gap-1'
              style={{
                position: 'absolute',
                insetBlockStart: '100%',
                insetInlineEnd: 0,
                background: 'var(--vhyx-color-surface, var(--vhyx-color-bg))',
                border: '1px solid var(--vhyx-color-border)',
                borderRadius: 8,
                padding: 4,
                marginBlockStart: 4
              }}
            >
              {QUICK_REACTIONS.map(e => (
                <button
                  key={e}
                  type='button'
                  onClick={() => react(e)}
                  aria-label={`React ${e}`}
                  style={{ background: 'none', border: 0, fontSize: 18, cursor: 'pointer', padding: 2 }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Thread({
  accountId,
  o,
  channel,
  rootId,
  onClose,
  subscribe,
  writable
}: {
  accountId: string
  o: ChatOverview
  channel: ChannelSummary
  rootId: string
  onClose: () => void
  subscribe: Sub
  writable: boolean
}) {
  const qc = useQueryClient()
  const composer = useRef<ComposerHandle>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const { data, error } = useQuery({
    queryKey: teamKeys.thread(accountId, rootId),
    queryFn: () => teamService.thread(accountId, rootId)
  })
  const typing = useTyping(subscribe, channel.id, rootId, o.me)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [data?.replies.length])

  const send = async (body: string) => {
    try {
      if (editing) {
        await teamService.edit(accountId, editing.id, body)
        setEditing(null)
      } else await teamService.send(accountId, channel.id, body, rootId)
      qc.invalidateQueries({ queryKey: teamKeys.thread(accountId, rootId) })
      qc.invalidateQueries({ queryKey: teamKeys.messages(accountId, channel.id) })

      return true
    } catch (e) {
      toast.danger((e as Error).message)

      return false
    }
  }

  return (
    <>
      <header
        className='flex items-center gap-2'
        style={{ padding: '10px 16px', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}
      >
        <strong style={{ flex: 1 }}>Thread</strong>
        <Button size='sm' variant='ghost' onClick={onClose} aria-label='Close thread'>
          <i className='tabler-x' aria-hidden />
        </Button>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', paddingBlock: 8 }} role='log' aria-label='Thread replies'>
        {error && <Alert variant='danger'>{(error as Error).message}</Alert>}
        {!data && !error && <Skeleton height='8rem' style={{ margin: 16 }} />}
        {data && (
          <>
            <MessageRow
              accountId={accountId}
              m={data.root}
              people={o.people}
              me={o.me}
              canModerate={o.canManage}
              grouped={false}
              onEdit={() => undefined}
              writable={false}
              inThread
            />
            <DayDivider label={`${data.replies.length} repl${data.replies.length === 1 ? 'y' : 'ies'}`} />
            {data.replies.map((m, i) => (
              <MessageRow
                key={m.id}
                accountId={accountId}
                m={m}
                people={o.people}
                me={o.me}
                canModerate={o.canManage}
                grouped={groupedWithPrevious(data.replies[i - 1], m)}
                onEdit={() => {
                  setEditing(m)
                  const e = toEditable(m.body, o.people)

                  composer.current?.set(e.text, e.picked)
                }}
                writable={writable}
                inThread
              />
            ))}
            <div ref={end} />
          </>
        )}
      </div>
      {writable && data && !data.root.deleted && (
        <div style={{ padding: '8px 16px 12px' }}>
          <div style={{ ...muted, fontSize: 12, minBlockSize: 16 }} aria-live='polite'>
            {typing}
          </div>
          <Composer
            ref={composer}
            people={o.people}
            me={o.me}
            label='Reply'
            placeholder='Reply…'
            onSubmit={send}
            onTyping={() => void teamService.typing(accountId, channel.id, rootId).catch(() => undefined)}
            submitLabel={editing ? 'Save' : 'Reply'}
          />
        </div>
      )}
    </>
  )
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function NewChannelDialog({
  accountId,
  o,
  onClose,
  onCreated
}: {
  accountId: string
  o: ChatOverview
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isPrivate, setPrivate] = useState(false)
  const [members, setMembers] = useState<string[]>([])
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  const atLimit = o.limits.channels >= o.limits.maxChannels
  const create = useMutation({
    mutationFn: () => teamService.createChannel(accountId, { name: clean, topic, isPrivate, memberIds: members }),
    onSuccess: c => {
      qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) })
      toast.success(`#${c.name} created`)
      onCreated(c.id)
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>New channel</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (clean) create.mutate()
            }}
          >
            {atLimit && (
              <Alert variant='warning'>
                You have {o.limits.channels} of {o.limits.maxChannels} channels. Archive or delete one, or upgrade.
              </Alert>
            )}
            <TextField
              name='name'
              label='Name'
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='api-reviews'
              hint={clean && clean !== name ? `Will be #${clean}` : 'Lowercase letters, digits, dashes'}
              autoFocus
            />
            <TextField
              name='topic'
              label='Topic (optional)'
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder='What this channel is for'
            />
            <label className='flex items-center gap-2' style={{ fontSize: 14 }}>
              <Checkbox checked={isPrivate} onCheckedChange={v => setPrivate(v === true)} /> Private: only people you
              add can see it
            </label>
            {isPrivate && (
              <PeoplePicker people={o.people.filter(p => p.id !== o.me)} value={members} onChange={setMembers} />
            )}
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={create.isPending} disabled={!clean || atLimit}>
                Create
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function PeoplePicker({
  people,
  value,
  onChange
}: {
  people: Person[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const [q, setQ] = useState('')
  const shown = people.filter(p => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className='flex flex-col gap-2'>
      <Input
        size='sm'
        placeholder='Find people'
        value={q}
        onChange={e => setQ(e.target.value)}
        aria-label='Find people'
      />
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxBlockSize: 220, overflowY: 'auto' }}>
        {shown.map(p => (
          <li key={p.id}>
            <label className='flex items-center gap-2' style={{ padding: '4px 2px', fontSize: 14, cursor: 'pointer' }}>
              <Checkbox
                checked={value.includes(p.id)}
                onCheckedChange={v => onChange(v === true ? [...value, p.id] : value.filter(x => x !== p.id))}
              />
              <PersonAvatar name={p.name} size='xs' />
              {p.name} <span style={{ ...muted, fontSize: 12 }}>{p.email}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li style={{ ...muted, fontSize: 13 }}>Nobody else matches. Invite people under Members.</li>
        )}
      </ul>
    </div>
  )
}

function NewDmDialog({
  accountId,
  o,
  onClose,
  onOpened
}: {
  accountId: string
  o: ChatOverview
  onClose: () => void
  onOpened: (id: string) => void
}) {
  const [members, setMembers] = useState<string[]>([])
  const open = useMutation({
    mutationFn: () => teamService.openDm(accountId, members),
    onSuccess: r => onOpened(r.id),
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Direct message</Dialog.Title>
          <PeoplePicker
            people={o.people.filter(p => p.id !== o.me)}
            value={members}
            onChange={v => setMembers(v.slice(0, 7))}
          />
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => open.mutate()} loading={open.isPending} disabled={!members.length}>
              Open
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function ChannelSettings({
  accountId,
  o,
  channel,
  onClose,
  onLeave
}: {
  accountId: string
  o: ChatOverview
  channel: ChannelSummary
  onClose: () => void
  onLeave: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic)
  const [add, setAdd] = useState<string[]>([])
  const done = () => (qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) }), onClose())
  const save = useMutation({
    mutationFn: (archived?: boolean) =>
      teamService.updateChannel(accountId, channel.id, {
        ...(name !== channel.name ? { name } : {}),
        ...(topic !== channel.topic ? { topic } : {}),
        ...(archived !== undefined ? { archived } : {})
      }),
    onSuccess: done,
    onError: e => toast.danger((e as Error).message)
  })
  const del = useMutation({
    mutationFn: () => teamService.deleteChannel(accountId, channel.id),
    onSuccess: done,
    onError: e => toast.danger((e as Error).message)
  })
  const addPeople = useMutation({
    mutationFn: () => teamService.addMembers(accountId, channel.id, add),
    onSuccess: done,
    onError: e => toast.danger((e as Error).message)
  })
  const general = channel.name === 'general'

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>#{channel.name}</Dialog.Title>
          <div className='flex flex-col gap-3'>
            <TextField
              name='name'
              label='Name'
              value={name}
              onChange={e => setName(e.target.value.toLowerCase())}
              disabled={!channel.canEdit || general}
            />
            <TextField
              name='topic'
              label='Topic'
              value={topic}
              onChange={e => setTopic(e.target.value)}
              disabled={!channel.canEdit}
            />
            {channel.canEdit && (
              <div>
                <Button
                  size='sm'
                  onClick={() => save.mutate(undefined)}
                  loading={save.isPending}
                  disabled={name === channel.name && topic === channel.topic}
                >
                  Save
                </Button>
              </div>
            )}
            {channel.isPrivate && (
              <>
                <strong style={{ fontSize: 14 }}>Add people</strong>
                <PeoplePicker
                  people={o.people.filter(p => !channel.memberIds?.includes(p.id))}
                  value={add}
                  onChange={setAdd}
                />
                <div>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => addPeople.mutate()}
                    disabled={!add.length}
                    loading={addPeople.isPending}
                  >
                    Add {add.length || ''}
                  </Button>
                </div>
              </>
            )}
            <div
              className='flex gap-2 flex-wrap'
              style={{ borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 12 }}
            >
              {!general && (channel.joined || channel.isPrivate) && (
                <Button size='sm' variant='outline' onClick={onLeave}>
                  Leave
                </Button>
              )}
              {channel.canEdit && !general && (
                <Button size='sm' variant='outline' onClick={() => save.mutate(!channel.archived)}>
                  {channel.archived ? 'Unarchive' : 'Archive'}
                </Button>
              )}
              {o.canManage && !general && (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={() => window.confirm(`Delete #${channel.name} and all its messages?`) && del.mutate()}
                  loading={del.isPending}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function SearchDialog({
  accountId,
  onClose,
  onMessage
}: {
  accountId: string
  onClose: () => void
  onMessage: (channelId: string, thread: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300)

    return () => clearTimeout(t)
  }, [q])
  const { data, isFetching } = useQuery({
    queryKey: ['team', accountId, 'search', term],
    queryFn: () => teamService.search(accountId, term),
    enabled: term.length >= 2
  })
  const empty = data && !data.messages.length && !data.docs.length && !data.issues.length

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='lg'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Search the team space</Dialog.Title>
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder='Messages, documents and issues'
            aria-label='Search'
            autoFocus
          />
          <div className='flex flex-col gap-4' style={{ marginBlockStart: 12 }} aria-live='polite'>
            {isFetching && <Skeleton height='4rem' />}
            {empty && <p style={muted}>Nothing found.</p>}
            {data && data.messages.length > 0 && (
              <section className='flex flex-col gap-1'>
                <strong style={{ fontSize: 13 }}>Messages</strong>
                {data.messages.map(m => (
                  <button
                    key={m.id}
                    type='button'
                    onClick={() => onMessage(m.channelId, m.parentId ?? m.id)}
                    style={{
                      textAlign: 'start',
                      background: 'none',
                      border: '1px solid var(--vhyx-color-border)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      color: 'inherit',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ ...muted, fontSize: 12 }}>
                      {m.channel} · {m.author} · {dayLabel(m.createdAt)}
                    </span>
                    <span style={{ display: 'block', fontSize: 14 }}>{m.excerpt}</span>
                  </button>
                ))}
              </section>
            )}
            {data && data.docs.length > 0 && (
              <section className='flex flex-col gap-1'>
                <strong style={{ fontSize: 13 }}>Documents</strong>
                {data.docs.map(d => (
                  <Link
                    key={d.id}
                    href={`/organizations/${accountId}/team/docs/${d.id}`}
                    style={{
                      color: 'inherit',
                      border: '1px solid var(--vhyx-color-border)',
                      borderRadius: 8,
                      padding: '6px 10px'
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>{d.title}</strong>
                    <span style={{ display: 'block', ...muted, fontSize: 13 }}>{d.excerpt}</span>
                  </Link>
                ))}
              </section>
            )}
            {data && data.issues.length > 0 && (
              <section className='flex flex-col gap-1'>
                <strong style={{ fontSize: 13 }}>Issues</strong>
                {data.issues.map(i => (
                  <Link
                    key={i.number}
                    href={`/organizations/${accountId}/team/issues/${i.number}`}
                    style={{
                      color: 'inherit',
                      border: '1px solid var(--vhyx-color-border)',
                      borderRadius: 8,
                      padding: '6px 10px'
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>
                      #{i.number} {i.title}
                    </strong>
                    <span style={{ display: 'block', ...muted, fontSize: 13 }}>{i.excerpt}</span>
                  </Link>
                ))}
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function SettingsDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['team', accountId, 'prefs'], queryFn: () => teamService.prefs(accountId) })
  const set = useMutation({
    mutationFn: (v: boolean) => teamService.setPrefs(accountId, v),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['team', accountId, 'prefs'] }), toast.success('Saved'))
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Notifications</Dialog.Title>
          <div className='flex flex-col gap-3' style={{ fontSize: 14 }}>
            <p style={{ margin: 0, ...muted }}>
              Mentions, replies to your threads and comments, and issues assigned to you appear under the bell at once.
            </p>
            <label className='flex items-center justify-between gap-3'>
              <span>
                <strong>Daily email digest</strong>
                <span style={{ display: 'block', ...muted, fontSize: 13 }}>
                  At most once a day, only when something is still unread after 30 minutes.
                </span>
              </span>
              <Switch
                checked={data?.emailDigest ?? true}
                disabled={!data || set.isPending}
                onCheckedChange={(v: boolean) => set.mutate(v)}
                aria-label='Daily email digest'
              />
            </label>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
