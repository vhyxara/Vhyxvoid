// Pure helpers for the team space views: mentions in the composer, message
// rendering, dates, issue fields, board moves, heading anchors and the
// folder tree. Mirrors parts of packages/shared/src/teamSpace.ts.

import type { DocSummary, Folder, IssuePriority, IssueStatus, Person } from '@/api/infrastructure/services/team.service'

// ── Mentions ────────────────────────────────────────────────────────────────

const MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi

/** The "@que" being typed just before the caret, or null. */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const m = /(^|[\s(])@([^\s@]{0,30})$/.exec(before)

  if (!m) return null

  return { query: m[2], start: before.length - m[2].length - 1 }
}

/** Replaces "@que" at start..caret with "@Name " and returns the new caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string
): { text: string; caret: number } {
  const ins = `@${name} `

  return { text: text.slice(0, start) + ins + text.slice(caret), caret: start + ins.length }
}

/**
 * Editable text -> stored body: "@Name" of people picked in this message
 * (map name -> id) become <@id>. Longest names first, so "@Ada Lovelace" wins
 * over "@Ada".
 */
export function toStored(text: string, picked: Record<string, string>): string {
  let out = text
  const names = Object.keys(picked).sort((a, b) => b.length - a.length)

  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    out = out.replace(new RegExp(`(^|[^\\w@])@${esc}(?![\\w])`, 'g'), (_, pre: string) => `${pre}<@${picked[name]}>`)
  }

  return out
}

/** Stored body -> editable text and the names it mentions (for editing a message). */
export function toEditable(body: string, people: Person[]): { text: string; picked: Record<string, string> } {
  const byId = new Map(people.map(p => [p.id, p.name]))
  const picked: Record<string, string> = {}

  const text = body.replace(MENTION_RE, (_, id: string) => {
    const name = byId.get(id.toLowerCase()) ?? 'someone'

    if (name !== 'someone') picked[name] = id.toLowerCase()

    return `@${name}`
  })

  return { text, picked }
}

/** For markdown rendering: <@id> -> [@Name](mention:id). */
export function withMentionLinks(body: string, people: Person[]): string {
  const byId = new Map(people.map(p => [p.id, p.name]))

  return body.replace(
    MENTION_RE,
    (_, id: string) =>
      `[@${(byId.get(id.toLowerCase()) ?? 'someone').replace(/[[\]]/g, '')}](mention:${id.toLowerCase()})`
  )
}

export const mentionsIn = (body: string) => [...new Set([...body.matchAll(MENTION_RE)].map(m => m[1].toLowerCase()))]

// ── Dates ───────────────────────────────────────────────────────────────────

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86_400_000)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'

  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  })
}

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Consecutive messages of one author within 5 minutes are grouped (one header). */
export function groupedWithPrevious(
  prev: { authorId: string; createdAt: string } | undefined,
  cur: { authorId: string; createdAt: string }
): boolean {
  if (!prev || prev.authorId !== cur.authorId) return false
  if (new Date(prev.createdAt).toDateString() !== new Date(cur.createdAt).toDateString()) return false

  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
}

// ── Issues ──────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<IssueStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELLED: 'Cancelled'
}
export const STATUS_ICON: Record<IssueStatus, string> = {
  BACKLOG: 'tabler-circle-dashed',
  TODO: 'tabler-circle',
  IN_PROGRESS: 'tabler-progress',
  IN_REVIEW: 'tabler-eye-check',
  DONE: 'tabler-circle-check',
  CANCELLED: 'tabler-circle-x'
}
export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  NONE: 'No priority',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent'
}
export const PRIORITY_ICON: Record<IssuePriority, string> = {
  NONE: 'tabler-line-dashed',
  LOW: 'tabler-antenna-bars-2',
  MEDIUM: 'tabler-antenna-bars-3',
  HIGH: 'tabler-antenna-bars-5',
  URGENT: 'tabler-alert-square-filled'
}

/** overdue | today | soon (within 3 days) | later | null */
export function dueState(
  due: string | null,
  closed: boolean,
  today = new Date()
): 'overdue' | 'today' | 'soon' | 'later' | null {
  if (!due || closed) return null
  const t = new Date(today.toISOString().slice(0, 10)).getTime()
  const d = new Date(due).getTime()

  if (d < t) return 'overdue'
  if (d === t) return 'today'
  if (d - t <= 3 * 86_400_000) return 'soon'

  return 'later'
}

/**
 * Board drop: the card numbers above and below the drop position in the
 * target column (the dragged card itself excluded).
 */
export function dropNeighbours(
  column: number[],
  dragged: number,
  index: number
): { before: number | null; after: number | null } {
  const rest = column.filter(n => n !== dragged)
  const i = Math.max(0, Math.min(index, rest.length))

  return { before: rest[i - 1] ?? null, after: rest[i] ?? null }
}

/** Moves a card locally (optimistic update), same rule as dropNeighbours. */
export function moveInColumns<T extends { number: number; status: IssueStatus }>(
  items: T[],
  dragged: number,
  status: IssueStatus,
  index: number
): T[] {
  const card = items.find(i => i.number === dragged)

  if (!card) return items
  const others = items.filter(i => i.number !== dragged)
  const col = others.filter(i => i.status === status)
  const at = Math.max(0, Math.min(index, col.length))
  const anchor = col[at]
  const moved = { ...card, status }

  if (!anchor) {
    const last = col[col.length - 1]
    const pos = last ? others.indexOf(last) + 1 : others.length

    return [...others.slice(0, pos), moved, ...others.slice(pos)]
  }

  const pos = others.indexOf(anchor)

  return [...others.slice(0, pos), moved, ...others.slice(pos)]
}

// ── Documents ───────────────────────────────────────────────────────────────

/** Same as headingAnchor in packages/shared (anchors in links must match). */
export function headingAnchor(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~[\]()]/g, '')
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-') || 'section'
  )
}

/** Anchor generator for one render: repeats get -1, -2 like the outline. */
export function anchorer(): (text: string) => string {
  const used = new Map<string, number>()

  return text => {
    const base = headingAnchor(text)
    const n = used.get(base) ?? 0

    used.set(base, n + 1)

    return n ? `${base}-${n}` : base
  }
}

export type TreeNode = { folder: Folder | null; children: TreeNode[]; docs: DocSummary[] }

/** Folders and documents as a tree (root = folder null), names sorted. */
export function buildTree(folders: Folder[], docs: DocSummary[]): TreeNode {
  const nodes = new Map<string, TreeNode>(folders.map(f => [f.id, { folder: f, children: [], docs: [] }]))
  const root: TreeNode = { folder: null, children: [], docs: [] }

  for (const f of folders) (nodes.get(f.parentId ?? '') ?? root).children.push(nodes.get(f.id)!)
  for (const d of docs) (nodes.get(d.folderId ?? '') ?? root).docs.push(d)

  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => a.folder!.name.localeCompare(b.folder!.name))
    n.docs.sort((a, b) => a.title.localeCompare(b.title))
    n.children.forEach(sort)
  }

  sort(root)

  return root
}

/** Ids of a folder and everything under it (a folder can't move into these). */
export function descendants(folders: Folder[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true

  while (grew) {
    grew = false

    for (const f of folders)
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
  }

  return out
}

export const QUICK_REACTIONS = ['👍', '❤️', '🎉', '😄', '👀', '🚀', '✅', '🙏'] as const
