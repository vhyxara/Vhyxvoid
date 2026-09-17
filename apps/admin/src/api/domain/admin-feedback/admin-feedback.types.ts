// Mirrors apps/api's Prisma enums exactly (schema.prisma) -- confirmed via
// curl, not just the schema, that these are the real values sent/accepted.
export type FeedbackType = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'GENERAL_FEEDBACK' | 'UI_ISSUE'
export type FeedbackStatus = 'OPEN' | 'UNDER_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'WONT_FIX'
export type FeedbackPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

// The status flow documented in feedback.routes.ts's own comment (OPEN ->
// UNDER_REVIEW -> IN_PROGRESS -> RESOLVED, or OPEN -> WONT_FIX/CLOSED) is
// NOT enforced anywhere -- confirmed by reading AdminUpdateFeedbackUseCase
// directly (no transition-graph check, `status` is set unconditionally)
// and empirically (a status can be set to any value regardless of the
// current one). The UI offers every value freely rather than implying a
// restriction the backend doesn't have.
export const FEEDBACK_STATUS_VALUES: FeedbackStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'WONT_FIX'
]
export const FEEDBACK_PRIORITY_VALUES: FeedbackPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

// GET /admin/feedback's real per-item shape, confirmed via curl. Includes a
// `user` object (id/email/firstName/lastName) -- present at runtime via
// PrismaFeedbackRepository.findAll()'s `include: { user: {...} }`, but NOT
// declared anywhere in apps/api's own FeedbackProps TypeScript type (a
// real, undeclared-but-present field, same class of gap as several prior
// screens' findings). GET /admin/feedback/:id (detail) does NOT include
// this -- findById() has no such include -- confirmed via curl, see
// AdminFeedbackDetail below.
export type AdminFeedbackListItem = {
  id: string
  userId: string
  accountId: string | null
  type: FeedbackType
  status: FeedbackStatus
  priority: FeedbackPriority
  title: string
  description: string
  stepsToReproduce: string | null
  expectedBehavior: string | null
  actualBehavior: string | null
  pageUrl: string | null
  userAgent: string | null
  appVersion: string | null
  attachments: string[]
  adminNotes: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
  }
}

// GET /admin/feedback/:id's real shape -- identical to the list item minus
// `user` (confirmed via curl: findById() never includes the relation).
export type AdminFeedbackDetail = Omit<AdminFeedbackListItem, 'user'>

// GET /admin/feedback's `extra.counts` -- confirmed via curl. Computed by
// AdminListFeedbackUseCase issuing 4 extra `findAll({limit:1})` calls just
// to read each status's `.total` -- works, but a real, minor inefficiency
// (5 DB round trips per list call), not something this frontend session
// can or should fix.
export type FeedbackCounts = {
  open: number
  underReview: number
  inProgress: number
  resolved: number
}

// PATCH /admin/feedback/:id's real response is narrower than the full
// entity -- {id, status, priority} only, confirmed via curl. Notably
// omits `adminNotes` even though the same call can update it -- the UI
// refetches the detail query after a successful update rather than
// trusting this response to reflect the new note.
export type AdminFeedbackUpdateResponse = {
  id: string
  status: FeedbackStatus
  priority: FeedbackPriority
}

export type UpdateFeedbackDTO = {
  status?: FeedbackStatus
  priority?: FeedbackPriority
  adminNotes?: string
}
