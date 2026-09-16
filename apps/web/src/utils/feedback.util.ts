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
