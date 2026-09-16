import type { ListFeedbackParams } from '@/api/domain/feedback/feedback.types'

export const feedbackKeys = {
  all: () => ['feedback'] as const,
  lists: () => ['feedback', 'list'] as const,
  list: (params?: ListFeedbackParams) => ['feedback', 'list', params] as const,
  detail: (feedbackId: string) => ['feedback', 'detail', feedbackId] as const
}
