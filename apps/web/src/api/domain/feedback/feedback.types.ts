export type FeedbackType = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'GENERAL_FEEDBACK' | 'UI_ISSUE'

export type FeedbackStatus = 'OPEN' | 'UNDER_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'WONT_FIX'

export type FeedbackPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

// ── List item — returned by GET /feedback ──────────────────────────────────

export type FeedbackListItem = {
  id: string
  type: FeedbackType
  status: FeedbackStatus
  priority: FeedbackPriority
  title: string
  description: string
  resolvedAt: string | null
  createdAt: string
}

// ── Full detail — returned by GET /feedback/:feedbackId ────────────────────

export type FeedbackDetail = {
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
}

// ── Submit payload ─────────────────────────────────────────────────────────

export type SubmitFeedbackPayload = {
  type: FeedbackType
  title: string
  description: string
  stepsToReproduce?: string | null
  expectedBehavior?: string | null
  actualBehavior?: string | null
  pageUrl?: string | null
  appVersion?: string | null
  accountId?: string | null
  attachments?: string[]
}

export type SubmitFeedbackResult = {
  id: string
}

// ── List params ────────────────────────────────────────────────────────────

export type ListFeedbackParams = {
  page?: number
  limit?: number
  status?: FeedbackStatus
  type?: FeedbackType
}
