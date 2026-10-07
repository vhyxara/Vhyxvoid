import { httpClient } from '@/api/wrapper/http'

// Mirrors packages/shared/src/teamSpace.ts and apps/api/src/modules/platform/team.

export type Person = { id: string; name: string; email: string; level: number }

export type TeamCard = {
  kind: string
  href: string
  title: string
  subtitle: string
  badge?: string
  missing?: boolean
}

export type ChannelSummary = {
  id: string
  kind: 'CHANNEL' | 'DM'
  name: string
  topic: string
  isPrivate: boolean
  refKind: string | null
  refId: string | null
  archived: boolean
  joined: boolean
  muted: boolean
  memberIds: string[] | null
  lastMessageAt: string | null
  canEdit: boolean
  unread: number
  mentions: number
}

export type ChatOverview = {
  enabled: boolean
  platformEnabled: boolean
  limits: { maxChannels: number; channels: number; historyDays: number | null }
  me: string
  canManage: boolean
  people: Person[]
  channels: ChannelSummary[]
}

export type Reaction = { emoji: string; count: number; mine: boolean; users: string[] }

export type ChatMessage = {
  id: string
  channelId: string
  parentId: string | null
  authorId: string
  authorName: string
  body: string
  deleted: boolean
  mentions: string[]
  cards: TeamCard[]
  reactions: Reaction[]
  replyCount: number
  lastReplyAt: string | null
  editedAt: string | null
  createdAt: string
}

export type MessagePage = {
  channel: { id: string; name: string | null; kind: string; topic: string; archived: boolean }
  messages: ChatMessage[]
  hasMore: boolean
  hiddenByPlan: number
  lastReadAt: string | null
}

export type SearchResults = {
  messages: Array<{
    id: string
    channelId: string
    parentId: string | null
    channel: string
    author: string
    excerpt: string
    createdAt: string
  }>
  docs: Array<{ id: string; title: string; excerpt: string; updatedAt: string }>
  issues: Array<{ number: number; title: string; status: IssueStatus; excerpt: string }>
}

export type Folder = { id: string; parentId: string | null; name: string }
export type DocSummary = {
  id: string
  title: string
  folderId: string | null
  updatedAt: string
  updatedBy: string | null
  createdById: string | null
}
export type DocsOverview = {
  enabled: boolean
  limits: { maxDocs: number; docs: number }
  canManage: boolean
  folders: Folder[]
  docs: DocSummary[]
}

export type OutlineEntry = { level: number; text: string; anchor: string; line: number }

export type TeamDoc = {
  id: string
  title: string
  body: string
  folderId: string | null
  version: number
  createdAt: string
  updatedAt: string
  createdBy: string | null
  updatedBy: string | null
  outline: OutlineEntry[]
  cards: Array<{ url: string; card?: TeamCard }>
  openComments: Record<string, number>
  latestVersion: number
  canDelete: boolean
  writable: boolean
}

export type DocVersion = { number: number; title: string; author: string | null; createdAt: string; updatedAt: string }
export type DiffLine = { op: ' ' | '+' | '-'; text: string }
export type DocDiff = {
  from: number
  to: number | 'current'
  titleChanged: { from: string; to: string } | null
  lines: DiffLine[]
  added: number
  removed: number
}

export type Comment = {
  id: string
  anchor: string | null
  authorId: string
  author: string
  body: string
  deleted: boolean
  resolved: boolean
  editedAt: string | null
  createdAt: string
}

export const ISSUE_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export const ISSUE_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

export type IssueSummary = {
  number: number
  title: string
  status: IssueStatus
  priority: IssuePriority
  assigneeId: string | null
  assignee: string | null
  labels: string[]
  dueDate: string | null
  rank: string
  linkCount: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export type IssuesOverview = {
  enabled: boolean
  limits: { maxIssues: number; issues: number }
  me: string
  people: Person[]
  labels: string[]
  counts: Record<IssueStatus, number>
  issues: IssueSummary[]
}

export type IssueEvent = {
  id: string
  kind: string
  actor: string | null
  from: unknown
  to: unknown
  fromName?: string | null
  toName?: string | null
  createdAt: string
}

export type Issue = IssueSummary & {
  body: string
  createdBy: string | null
  links: Array<{ url: string; card?: TeamCard }>
  events: IssueEvent[]
  comments: Comment[]
  canDelete: boolean
  writable: boolean
}

export type IssueInput = Partial<{
  title: string
  body: string
  status: IssueStatus
  priority: IssuePriority
  assigneeId: string | null
  labels: string[]
  dueDate: string | null
  links: string[]
}>

const base = (accountId: string) => `/team/${encodeURIComponent(accountId)}`

export const teamService = {
  chat: (a: string) => httpClient<ChatOverview>({ url: `${base(a)}/chat`, method: 'GET' }),
  createChannel: (
    a: string,
    data: { name: string; topic?: string; isPrivate?: boolean; memberIds?: string[]; refKind?: string; refId?: string }
  ) => httpClient<{ id: string; name: string }>({ url: `${base(a)}/chat/channels`, method: 'POST', data }),
  updateChannel: (a: string, cid: string, data: { name?: string; topic?: string; archived?: boolean }) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/channels/${cid}`, method: 'PATCH', data }),
  deleteChannel: (a: string, cid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/channels/${cid}`, method: 'DELETE' }),
  join: (a: string, cid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/channels/${cid}/join`, method: 'POST', data: {} }),
  leave: (a: string, cid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/channels/${cid}/leave`, method: 'POST', data: {} }),
  addMembers: (a: string, cid: string, userIds: string[]) =>
    httpClient<{ added: number }>({
      url: `${base(a)}/chat/channels/${cid}/members`,
      method: 'POST',
      data: { userIds }
    }),
  openDm: (a: string, userIds: string[]) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/dms`, method: 'POST', data: { userIds } }),
  messages: (a: string, cid: string, before?: string) =>
    httpClient<MessagePage>({
      url: `${base(a)}/chat/channels/${cid}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      method: 'GET'
    }),
  thread: (a: string, mid: string) =>
    httpClient<{ root: ChatMessage; replies: ChatMessage[] }>({
      url: `${base(a)}/chat/messages/${mid}/thread`,
      method: 'GET'
    }),
  send: (a: string, cid: string, body: string, parentId?: string) =>
    httpClient<ChatMessage>({
      url: `${base(a)}/chat/channels/${cid}/messages`,
      method: 'POST',
      data: { body, ...(parentId ? { parentId } : {}) }
    }),
  edit: (a: string, mid: string, body: string) =>
    httpClient<ChatMessage>({ url: `${base(a)}/chat/messages/${mid}`, method: 'PATCH', data: { body } }),
  remove: (a: string, mid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/messages/${mid}`, method: 'DELETE' }),
  react: (a: string, mid: string, emoji: string) =>
    httpClient<{ id: string; reactions: Reaction[] }>({
      url: `${base(a)}/chat/messages/${mid}/reactions`,
      method: 'POST',
      data: { emoji }
    }),
  read: (a: string, cid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/chat/channels/${cid}/read`, method: 'POST', data: {} }),
  typing: (a: string, cid: string, parentId?: string) =>
    httpClient<object>({
      url: `${base(a)}/chat/channels/${cid}/typing`,
      method: 'POST',
      data: parentId ? { parentId } : {}
    }),
  search: (a: string, q: string) =>
    httpClient<SearchResults>({ url: `${base(a)}/search?q=${encodeURIComponent(q)}`, method: 'GET' }),
  prefs: (a: string) => httpClient<{ emailDigest: boolean }>({ url: `${base(a)}/prefs`, method: 'GET' }),
  setPrefs: (a: string, emailDigest: boolean) =>
    httpClient<{ emailDigest: boolean }>({ url: `${base(a)}/prefs`, method: 'PUT', data: { emailDigest } }),

  docs: (a: string) => httpClient<DocsOverview>({ url: `${base(a)}/docs`, method: 'GET' }),
  createFolder: (a: string, name: string, parentId?: string | null) =>
    httpClient<Folder>({ url: `${base(a)}/docs/folders`, method: 'POST', data: { name, parentId: parentId ?? null } }),
  updateFolder: (a: string, fid: string, data: { name?: string; parentId?: string | null }) =>
    httpClient<Folder>({ url: `${base(a)}/docs/folders/${fid}`, method: 'PATCH', data }),
  deleteFolder: (a: string, fid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/docs/folders/${fid}`, method: 'DELETE' }),
  createDoc: (a: string, data: { title: string; folderId?: string | null; body?: string }) =>
    httpClient<{ id: string; title: string; version: number }>({ url: `${base(a)}/docs`, method: 'POST', data }),
  doc: (a: string, id: string) => httpClient<TeamDoc>({ url: `${base(a)}/docs/${id}`, method: 'GET' }),
  saveDoc: (
    a: string,
    id: string,
    data: { title?: string; body?: string; folderId?: string | null; expectedVersion?: number }
  ) =>
    httpClient<{
      id: string
      version: number
      title: string
      latestVersion: number
      updatedAt: string
      outline: OutlineEntry[]
    }>({ url: `${base(a)}/docs/${id}`, method: 'PUT', data }),
  deleteDoc: (a: string, id: string) => httpClient<{ id: string }>({ url: `${base(a)}/docs/${id}`, method: 'DELETE' }),
  docVersions: (a: string, id: string) =>
    httpClient<{ versions: DocVersion[] }>({ url: `${base(a)}/docs/${id}/versions`, method: 'GET' }),
  docDiff: (a: string, id: string, from: number, to: number | 'current') =>
    httpClient<DocDiff>({ url: `${base(a)}/docs/${id}/diff?from=${from}&to=${to}`, method: 'GET' }),
  restoreDoc: (a: string, id: string, n: number) =>
    httpClient<{ id: string; version: number }>({
      url: `${base(a)}/docs/${id}/versions/${n}/restore`,
      method: 'POST',
      data: {}
    }),

  comments: (a: string, target: string) =>
    httpClient<{ comments: Comment[] }>({
      url: `${base(a)}/comments?target=${encodeURIComponent(target)}`,
      method: 'GET'
    }),
  comment: (a: string, data: { target: string; body: string; anchor?: string | null }) =>
    httpClient<Comment>({ url: `${base(a)}/comments`, method: 'POST', data }),
  updateComment: (a: string, cid: string, data: { body?: string; resolved?: boolean }) =>
    httpClient<Comment>({ url: `${base(a)}/comments/${cid}`, method: 'PATCH', data }),
  deleteComment: (a: string, cid: string) =>
    httpClient<{ id: string }>({ url: `${base(a)}/comments/${cid}`, method: 'DELETE' }),

  issues: (a: string, q: string, sort = 'updated') =>
    httpClient<IssuesOverview>({ url: `${base(a)}/issues?${new URLSearchParams({ q, sort })}`, method: 'GET' }),
  createIssue: (a: string, data: IssueInput & { title: string }) =>
    httpClient<IssueSummary>({ url: `${base(a)}/issues`, method: 'POST', data }),
  issue: (a: string, n: number) => httpClient<Issue>({ url: `${base(a)}/issues/${n}`, method: 'GET' }),
  updateIssue: (a: string, n: number, data: IssueInput) =>
    httpClient<IssueSummary>({ url: `${base(a)}/issues/${n}`, method: 'PATCH', data }),
  moveIssue: (a: string, n: number, data: { status: IssueStatus; before?: number | null; after?: number | null }) =>
    httpClient<IssueSummary>({ url: `${base(a)}/issues/${n}/move`, method: 'POST', data }),
  deleteIssue: (a: string, n: number) =>
    httpClient<{ number: number }>({ url: `${base(a)}/issues/${n}`, method: 'DELETE' })
}

export const teamKeys = {
  chat: (a: string) => ['team', a, 'chat'] as const,
  messages: (a: string, cid: string) => ['team', a, 'messages', cid] as const,
  thread: (a: string, mid: string) => ['team', a, 'thread', mid] as const,
  docs: (a: string) => ['team', a, 'docs'] as const,
  doc: (a: string, id: string) => ['team', a, 'doc', id] as const,
  issues: (a: string) => ['team', a, 'issues'] as const,
  issue: (a: string, n: number) => ['team', a, 'issue', n] as const,
  comments: (a: string, target: string) => ['team', a, 'comments', target] as const
}
