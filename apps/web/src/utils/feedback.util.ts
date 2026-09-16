import type { FeedbackType, FeedbackStatus, FeedbackPriority } from '@/api/domain/feedback/feedback.types'

// Use Record<FeedbackType, ...> so indexing is type-safe
const TYPE_COLOR: Record<FeedbackType, 'error' | 'info' | 'warning' | 'success'> = {
  BUG_REPORT: 'error',
  UI_ISSUE: 'info',
  FEATURE_REQUEST: 'warning',
  GENERAL_FEEDBACK: 'success'
}

const STATUS_COLOR: Record<FeedbackStatus, 'warning' | 'info' | 'primary' | 'success' | 'default' | 'error'> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'info',
  IN_PROGRESS: 'primary',
  RESOLVED: 'success',
  CLOSED: 'default',
  WONT_FIX: 'error'
}

const PRIORITY_COLOR: Record<FeedbackPriority, 'default' | 'warning' | 'error'> = {
  LOW: 'default',
  MEDIUM: 'warning',
  HIGH: 'error',
  CRITICAL: 'error'
}

export function typeColor(type: FeedbackType) {
  return TYPE_COLOR[type]
}

export function statusColor(status: FeedbackStatus) {
  return STATUS_COLOR[status]
}

export function priorityColor(p: FeedbackPriority) {
  return PRIORITY_COLOR[p]
}

export function typeLabel(type: FeedbackType) {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase())
}

// typeColor/statusColor/priorityColor above return MUI-style color names.
// VhyxUI's Badge has no 'error'/'primary' variant (only default/success/
// warning/danger/info/outline) — same mapping pattern as MembersTable/
// ApiKeysView/TunnelsView's own roleBadgeVariant/statusBadgeVariant/
// envBadgeVariant. Shared here since both FeedbackHistoryTab.tsx and
// FeedbackDetailDrawer.tsx need the identical mapping.
export function feedbackBadgeVariant(muiColor: 'error' | 'info' | 'warning' | 'success' | 'primary' | 'default') {
  if (muiColor === 'error') return 'danger' as const
  if (muiColor === 'primary') return 'default' as const

  return muiColor
}
