'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'

type FeedbackType = 'success' | 'error' | 'warning' | 'info'

export interface FeedbackDialogState {
  feedbackOpen: boolean
  feedbackMessage: string
  feedbackType: FeedbackType
  customIcon?: ReactNode

  showFeedback: (
    message: string,
    options?: {
      type?: FeedbackType
      icon?: ReactNode
    }
  ) => void

  handleClose: () => void
}

const useFeedbackDialog = (): FeedbackDialogState => {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('success')
  const [customIcon, setCustomIcon] = useState<ReactNode>()

  const showFeedback: FeedbackDialogState['showFeedback'] = (message, options = {}) => {
    const { type = 'success', icon } = options

    setFeedbackMessage(message)
    setFeedbackType(type)
    setCustomIcon(icon)
    setFeedbackOpen(true)
  }

  const handleClose = () => setFeedbackOpen(false)

  return {
    feedbackMessage,
    feedbackOpen,
    feedbackType,
    customIcon,
    showFeedback,
    handleClose
  }
}

export default useFeedbackDialog

// src/hooks/useFeedbackDialog.ts — replace entire file content with re-export
export type { FeedbackType, FeedbackStatus, FeedbackPriority } from '@/api/domain/feedback/feedback.types'
