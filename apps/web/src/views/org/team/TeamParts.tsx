'use client'

// Pieces shared by Chat, Docs and Issues: the live-update socket, rich text
// with mentions, cards for linked objects, the mention-aware composer and
// "Share to chat".

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'

import Link from 'next/link'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Avatar, Button, Dialog, SelectField, TextareaField, toast } from '@vhyxui/react'

import { getAccessToken } from '@/api/domain/identity/store/auth.store'
import { teamKeys, teamService, type Person, type TeamCard } from '@/api/infrastructure/services/team.service'
import { anchorer, insertMention, mentionQuery, toStored, withMentionLinks } from './teamForm'

export const muted: CSSProperties = { color: 'var(--vhyx-color-text-muted)' }
export const mono: CSSProperties = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 }

// ── Live updates ────────────────────────────────────────────────────────────

export type TeamEvent = { kind: string; payload: Record<string, unknown>; seq: string }
type Listener = (e: TeamEvent) => void

function socketUrl(): string {
  const api = process.env.NEXT_PUBLIC_API_URL_LIVE ?? ''
  const base = /^https?:\/\//.test(api) ? new URL(api) : new URL(api || '/api/v1', window.location.origin)

  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = '/api/v1/team/ws'

  return base.toString()
}

/**
 * One WebSocket per page: refreshes the cached chat, docs and issues as
 * events arrive, and lets views listen for typing and edits by others.
 * Reconnects with backoff; status is "live" while connected.
 */
export function useTeamSocket(accountId: string, enabled = true) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const listeners = useRef(new Set<Listener>())

  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let retry: ReturnType<typeof setTimeout> | null = null
    let ping: ReturnType<typeof setInterval> | null = null

    const handle = (e: TeamEvent) => {
      const p = e.payload
      const cid = typeof p.channelId === 'string' ? p.channelId : null

      if (['message', 'message.edited', 'message.deleted', 'reaction'].includes(e.kind)) {
        if (cid) qc.invalidateQueries({ queryKey: teamKeys.messages(accountId, cid) })
        const msg = p.message as { parentId?: string | null; id?: string } | undefined
        const parent = (typeof p.parentId === 'string' && p.parentId) || msg?.parentId

        if (parent) qc.invalidateQueries({ queryKey: teamKeys.thread(accountId, parent) })
        if (typeof p.messageId === 'string') qc.invalidateQueries({ queryKey: teamKeys.thread(accountId, p.messageId) })
        if (msg?.id) qc.invalidateQueries({ queryKey: teamKeys.thread(accountId, msg.id) })
        qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) })
      } else if (e.kind === 'channel' || e.kind === 'channel.deleted' || e.kind === 'read') {
        qc.invalidateQueries({ queryKey: teamKeys.chat(accountId) })
      } else if (e.kind === 'doc') {
        qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) })
        if (p.comments && typeof p.docId === 'string')
          qc.invalidateQueries({ queryKey: teamKeys.comments(accountId, `doc:${p.docId}`) })
      } else if (e.kind === 'issue') {
        qc.invalidateQueries({ queryKey: teamKeys.issues(accountId) })
        if (typeof p.number === 'number') qc.invalidateQueries({ queryKey: teamKeys.issue(accountId, p.number) })
        if (p.comments) qc.invalidateQueries({ queryKey: ['team', accountId, 'issue'] })
      }

      listeners.current.forEach(l => l(e))
    }

    const connect = () => {
      if (stopped) return
      setStatus('connecting')
      ws = new WebSocket(socketUrl())
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token: getAccessToken() ?? '', accountId }))
      ws.onmessage = m => {
        let msg: { type: string } & Partial<TeamEvent>

        try {
          msg = JSON.parse(String(m.data))
        } catch {
          return
        }

        if (msg.type === 'ready') {
          attempt = 0
          setStatus('live')
          // Catch up on anything missed while disconnected.
          qc.invalidateQueries({ queryKey: ['team', accountId] })
        } else if (msg.type === 'event') handle(msg as TeamEvent)
      }

      ws.onclose = () => {
        if (ping) clearInterval(ping)
        if (stopped) return
        setStatus('offline')
        attempt++
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)))
      }

      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000)
    }

    connect()

    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      if (ping) clearInterval(ping)
      ws?.close()
    }
  }, [accountId, enabled, qc])

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l)

    return () => void listeners.current.delete(l)
  }, [])

  return { status, subscribe }
}

export function LiveDot({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const color =
    status === 'live'
      ? 'var(--vhyx-color-success)'
      : status === 'connecting'
        ? 'var(--vhyx-color-warning)'
        : 'var(--vhyx-color-danger)'
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline, retrying'

  return (
    <span className='flex items-center gap-1' style={{ ...muted, fontSize: 12 }} role='status'>
      <span
        aria-hidden
        style={{ inlineSize: 8, blockSize: 8, borderRadius: 999, background: color, display: 'inline-block' }}
      />
      {label}
    </span>
  )
}

/** The workspace's people, shared by every team view (from the chat overview). */
export function usePeople(accountId: string, enabled = true): Person[] {
  const { data } = useQuery({
    queryKey: teamKeys.chat(accountId),
    queryFn: () => teamService.chat(accountId),
    enabled,
    staleTime: 30_000
  })

  return data?.people ?? []
}

// ── Rich text ───────────────────────────────────────────────────────────────

/** Bare links become markdown autolinks (dashboard paths too), outside code. */
function autolink(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /(^|[\s(])((?:https?:\/\/|\/(?:[a-z]{2}\/)?organizations\/)[^\s<>()]+[^\s<>().,;:!?])/g,
            (_, pre: string, url: string) => (url.startsWith('/') ? `${pre}[${url}](${url})` : `${pre}<${url}>`)
          )
    )
    .join('')
}

/**
 * Markdown (GFM, no raw HTML) with <@id> mentions as chips and dashboard
 * links opening in the app. `anchors` gives headings ids for doc links.
 */
export function RichText({
  text,
  people,
  me,
  anchors,
  compact
}: {
  text: string
  people: Person[]
  me?: string
  anchors?: boolean
  compact?: boolean
}) {
  const md = useMemo(() => withMentionLinks(autolink(text), people), [text, people])
  const next = anchors ? anchorer() : null
  const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    function H({ children }: { children?: ReactNode }) {
      const plain = flatten(children)

      return <Tag id={next ? next(plain) : undefined}>{children}</Tag>
    }

  return (
    <div className={compact ? 'vv-rich vv-rich-compact' : 'vv-rich'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={url =>
          url.startsWith('mention:') || url.startsWith('/') || /^https?:|^mailto:/i.test(url) ? url : ''
        }
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('mention:')) {
              const id = href.slice(8)

              return (
                <span className='vv-mention' data-me={id === me || undefined}>
                  {children}
                </span>
              )
            }

            if (href?.startsWith('/')) return <Link href={href}>{children}</Link>

            return (
              <a href={href} target='_blank' rel='noreferrer noopener'>
                {children}
              </a>
            )
          },
          ...(anchors
            ? {
                h1: heading('h1'),
                h2: heading('h2'),
                h3: heading('h3'),
                h4: heading('h4'),
                h5: heading('h5'),
                h6: heading('h6')
              }
            : {})
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  )
}

function flatten(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join('')
  if (node && typeof node === 'object' && 'props' in node)
    return flatten((node as { props: { children?: ReactNode } }).props.children)

  return ''
}

export const RICH_CSS = `
.vv-rich { font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.vv-rich p { margin: 0 0 6px; }
.vv-rich p:last-child { margin-bottom: 0; }
.vv-rich-compact p { margin: 0; }
.vv-rich ul, .vv-rich ol { margin: 4px 0 6px; padding-inline-start: 22px; }
.vv-rich code { font-family: var(--vhyx-font-mono, ui-monospace, monospace); font-size: 0.9em; background: var(--vhyx-color-bg-muted); padding: 1px 4px; border-radius: 4px; }
.vv-rich pre { background: var(--vhyx-color-bg-muted); padding: 10px 12px; border-radius: 8px; overflow: auto; margin: 6px 0; }
.vv-rich pre code { background: none; padding: 0; }
.vv-rich blockquote { margin: 6px 0; padding-inline-start: 10px; border-inline-start: 3px solid var(--vhyx-color-border-strong, var(--vhyx-color-border)); color: var(--vhyx-color-text-muted); }
.vv-rich a { color: var(--vhyx-color-accent); }
.vv-rich table { border-collapse: collapse; margin: 6px 0; }
.vv-rich th, .vv-rich td { border: 1px solid var(--vhyx-color-border); padding: 4px 8px; }
.vv-rich h1, .vv-rich h2, .vv-rich h3, .vv-rich h4 { margin: 14px 0 6px; line-height: 1.3; scroll-margin-top: 16px; }
.vv-rich h1 { font-size: 24px; } .vv-rich h2 { font-size: 19px; } .vv-rich h3 { font-size: 16px; }
.vv-rich img { max-width: 100%; }
.vv-mention { color: var(--vhyx-color-accent); background: var(--vhyx-color-accent-subtle, rgba(124,58,237,.12)); border-radius: 4px; padding: 0 3px; font-weight: 600; }
.vv-mention[data-me] { background: rgba(245, 158, 11, .22); color: inherit; }
`

// ── Cards ───────────────────────────────────────────────────────────────────

const CARD_ICON: Record<string, string> = {
  mock: 'tabler-api',
  mockEndpoint: 'tabler-route',
  collection: 'tabler-folder',
  request: 'tabler-send',
  inspector: 'tabler-radar-2',
  loadTest: 'tabler-activity-heartbeat',
  monitor: 'tabler-heartbeat',
  spec: 'tabler-book',
  specOperation: 'tabler-book',
  doc: 'tabler-file-text',
  issue: 'tabler-circle-dot',
  channel: 'tabler-hash'
}

export function CardList({ cards, onRemove }: { cards: Array<TeamCard | undefined>; onRemove?: (i: number) => void }) {
  const list = cards.map((c, i) => ({ c, i })).filter((x): x is { c: TeamCard; i: number } => !!x.c)

  if (!list.length) return null

  return (
    <div className='flex flex-col gap-2' style={{ marginBlockStart: 6 }}>
      {list.map(({ c, i }) => (
        <div
          key={`${c.href}-${i}`}
          className='flex items-start gap-3'
          style={{
            border: '1px solid var(--vhyx-color-border)',
            borderInlineStart: '3px solid var(--vhyx-color-accent)',
            borderRadius: 8,
            padding: '8px 10px',
            maxInlineSize: 520,
            background: 'var(--vhyx-color-bg-subtle)',
            opacity: c.missing ? 0.65 : 1
          }}
        >
          <i
            className={CARD_ICON[c.kind] ?? 'tabler-link'}
            aria-hidden
            style={{ fontSize: 18, marginBlockStart: 2, color: 'var(--vhyx-color-accent)' }}
          />
          <div className='flex flex-col' style={{ minInlineSize: 0, flex: 1 }}>
            <Link
              href={c.href}
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {c.title}
            </Link>
            <span style={{ ...muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.subtitle}</span>
          </div>
          {c.badge && (
            <span
              style={{
                ...mono,
                fontSize: 11,
                border: '1px solid var(--vhyx-color-border)',
                borderRadius: 6,
                padding: '1px 6px',
                whiteSpace: 'nowrap'
              }}
            >
              {c.badge}
            </span>
          )}
          {onRemove && (
            <Button size='sm' variant='ghost' onClick={() => onRemove(i)} aria-label={`Remove link to ${c.title}`}>
              <i className='tabler-x' aria-hidden />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

export function PersonAvatar({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  return <Avatar name={name} size={size} />
}

// ── Composer ────────────────────────────────────────────────────────────────

export type ComposerHandle = { focus: () => void; set: (text: string, picked?: Record<string, string>) => void }

type ComposerProps = {
  people: Person[]
  me?: string
  placeholder: string
  /** Called with the stored body (<@id> mentions); resolve true to clear. */
  onSubmit: (body: string) => Promise<boolean> | boolean
  onTyping?: () => void
  onEscape?: () => void
  disabled?: boolean
  submitLabel?: string
  minRows?: number
  /** Enter sends (chat); otherwise Ctrl/⌘+Enter (comments). */
  enterSends?: boolean
  label: string
}

/** A textarea with @mention suggestions; "@Name" is stored as <@id>. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    people,
    me,
    placeholder,
    onSubmit,
    onTyping,
    onEscape,
    disabled,
    submitLabel = 'Send',
    minRows = 1,
    enterSends = true,
    label
  },
  ref
) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    set: (t, p = {}) => {
      setText(t)
      setPicked(p)
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(t.length, t.length)
      })
    }
  }))

  const q = mentionQuery(text, caret)
  const matches = q
    ? people
        .filter(
          p =>
            p.id !== me &&
            (p.name.toLowerCase().includes(q.query.toLowerCase()) ||
              p.email.toLowerCase().startsWith(q.query.toLowerCase()))
        )
        .slice(0, 6)
    : []

  const choose = (p: Person) => {
    if (!q) return
    const r = insertMention(text, q.start, caret, p.name)

    setText(r.text)
    setPicked(x => ({ ...x, [p.name]: p.id }))
    setCaret(r.caret)
    requestAnimationFrame(() => area.current?.setSelectionRange(r.caret, r.caret))
  }

  const submit = async () => {
    const body = toStored(text.trim(), picked)

    if (!body || busy) return
    setBusy(true)

    try {
      if (await onSubmit(body)) {
        setText('')
        setPicked({})
      }
    } finally {
      setBusy(false)
      area.current?.focus()
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(a => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)

        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(matches[Math.min(active, matches.length - 1)])

        return
      }
    }

    if (e.key === 'Escape') onEscape?.()
    if (e.key === 'Enter' && ((enterSends && !e.shiftKey) || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  const rows = Math.min(10, Math.max(minRows, text.split('\n').length))

  return (
    <div style={{ position: 'relative' }}>
      {matches.length > 0 && (
        <ul
          role='listbox'
          aria-label='People'
          style={{
            position: 'absolute',
            insetBlockEnd: '100%',
            insetInlineStart: 0,
            marginBlockEnd: 4,
            listStyle: 'none',
            padding: 4,
            background: 'var(--vhyx-color-surface-overlay, var(--vhyx-color-surface, var(--vhyx-color-bg)))',
            border: '1px solid var(--vhyx-color-border)',
            borderRadius: 8,
            minInlineSize: 220,
            zIndex: 20,
            boxShadow: '0 8px 24px rgba(0,0,0,.25)'
          }}
        >
          {matches.map((p, i) => (
            <li key={p.id} role='option' aria-selected={i === active}>
              <button
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  choose(p)
                }}
                className='flex items-center gap-2'
                style={{
                  inlineSize: '100%',
                  background: i === active ? 'var(--vhyx-color-bg-muted)' : 'none',
                  border: 0,
                  borderRadius: 6,
                  padding: '4px 8px',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'start'
                }}
              >
                <PersonAvatar name={p.name} size='xs' />
                <span>{p.name}</span>
                <span style={{ ...muted, fontSize: 12 }}>{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        className='flex items-end gap-2'
        style={{
          border: '1px solid var(--vhyx-color-border)',
          borderRadius: 10,
          padding: 6,
          background: 'var(--vhyx-color-bg)'
        }}
      >
        <textarea
          ref={area}
          aria-label={label}
          value={text}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setActive(0)

            if (onTyping && Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now()
              onTyping()
            }
          }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          style={{
            flex: 1,
            minInlineSize: 0,
            resize: 'none',
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontSize: 14,
            lineHeight: 1.5,
            padding: '4px 6px'
          }}
        />
        <Button size='sm' onClick={submit} loading={busy} disabled={disabled || !text.trim()} aria-label={submitLabel}>
          {submitLabel}
        </Button>
      </div>
      <span style={{ ...muted, fontSize: 11 }}>
        {enterSends ? 'Enter sends · Shift+Enter new line' : 'Ctrl/⌘+Enter sends'} · @ mentions · Markdown · paste a
        dashboard link to share it as a card
      </span>
    </div>
  )
})

// ── Share to chat ───────────────────────────────────────────────────────────

/** "Share to chat": posts the current page (or `path`) to a channel as a card. */
export function ShareToChatButton({
  accountId,
  path,
  label = 'Share to chat',
  size = 'sm'
}: {
  accountId: string
  path?: string
  label?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size={size} variant='outline' onClick={() => setOpen(true)} icon={<i className='tabler-message-share' />}>
        {label}
      </Button>
      {open && <ShareDialog accountId={accountId} path={path} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareDialog({ accountId, path, onClose }: { accountId: string; path?: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: teamKeys.chat(accountId), queryFn: () => teamService.chat(accountId) })
  const [channel, setChannel] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const link = path ?? `${window.location.pathname}${window.location.search}${window.location.hash}`
  const channels = (data?.channels ?? []).filter(c => !c.archived && (c.kind === 'DM' || c.joined || !c.isPrivate))

  useEffect(() => {
    if (!channel && channels.length) setChannel(channels.find(c => c.name === 'general')?.id ?? channels[0].id)
  }, [channel, channels])

  return (
    <Dialog open onOpenChange={o => !o && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Share to chat</Dialog.Title>
          <div className='flex flex-col gap-3'>
            <SelectField
              name='channel'
              label='Channel or conversation'
              value={channel}
              onValueChange={setChannel}
              options={channels.map(c => ({ value: c.id, label: c.kind === 'DM' ? `@ ${c.name}` : `# ${c.name}` }))}
            />
            <TextareaField
              name='note'
              label='Message (optional)'
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder='Can someone look at this?'
            />
            <code style={{ ...mono, ...muted, wordBreak: 'break-all' }}>{link}</code>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!channel}
              onClick={async () => {
                setBusy(true)

                try {
                  await teamService.send(accountId, channel, `${note.trim() ? `${note.trim()}\n\n` : ''}${link}`)
                  toast.success('Shared')
                  onClose()
                } catch (e) {
                  toast.danger((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Share
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── A plain textarea with @mention suggestions (documents, issue bodies) ────

type AreaProps = {
  value: string
  onChange: (text: string) => void
  onPick: (name: string, id: string) => void
  people: Person[]
  me?: string
  label: string
  placeholder?: string
  rows?: number
  style?: CSSProperties
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  disabled?: boolean
}

/** The text holds "@Name"; the caller keeps the picked names (toStored on save). */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, AreaProps>(function MentionTextarea(
  { value, onChange, onPick, people, me, label, placeholder, rows = 12, style, onKeyDown, disabled },
  ref
) {
  const inner = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)

  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement)
  const q = mentionQuery(value, caret)
  const matches = q
    ? people.filter(p => p.id !== me && p.name.toLowerCase().includes(q.query.toLowerCase())).slice(0, 6)
    : []
  const choose = (p: Person) => {
    if (!q) return
    const r = insertMention(value, q.start, caret, p.name)

    onChange(r.text)
    onPick(p.name, p.id)
    setCaret(r.caret)
    requestAnimationFrame(() => inner.current?.setSelectionRange(r.caret, r.caret))
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={inner}
        aria-label={label}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck
        onChange={e => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setActive(0)
        }}
        onSelect={e => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={e => {
          if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setActive(a => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)

            return
          }

          if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault()
            choose(matches[Math.min(active, matches.length - 1)])

            return
          }

          onKeyDown?.(e)
        }}
        style={{
          inlineSize: '100%',
          resize: 'vertical',
          font: 'inherit',
          fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)',
          fontSize: 13,
          lineHeight: 1.6,
          padding: 12,
          border: '1px solid var(--vhyx-color-border)',
          borderRadius: 10,
          background: 'var(--vhyx-color-bg)',
          color: 'inherit',
          ...style
        }}
      />
      {matches.length > 0 && (
        <ul
          role='listbox'
          aria-label='People'
          style={{
            position: 'absolute',
            insetBlockStart: 8,
            insetInlineEnd: 8,
            listStyle: 'none',
            padding: 4,
            margin: 0,
            background: 'var(--vhyx-color-surface-overlay, var(--vhyx-color-surface, var(--vhyx-color-bg)))',
            border: '1px solid var(--vhyx-color-border)',
            borderRadius: 8,
            minInlineSize: 200,
            zIndex: 20
          }}
        >
          {matches.map((p, i) => (
            <li key={p.id} role='option' aria-selected={i === active}>
              <button
                type='button'
                onMouseDown={e => {
                  e.preventDefault()
                  choose(p)
                }}
                style={{
                  inlineSize: '100%',
                  textAlign: 'start',
                  background: i === active ? 'var(--vhyx-color-bg-muted)' : 'none',
                  border: 0,
                  borderRadius: 6,
                  padding: '4px 8px',
                  color: 'inherit',
                  cursor: 'pointer'
                }}
              >
                @{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
