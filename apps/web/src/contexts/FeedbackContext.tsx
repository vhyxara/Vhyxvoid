'use client'

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react'

import { Button, Dialog, DialogActions, DialogContent, Typography } from '@mui/material'
import classNames from 'classnames'


// import useFeedbackDialog from '@/libs/components/useFeedbackDialog'
import type { FeedbackDialogState } from '@/hooks/useFeedbackDialog';
import useFeedbackDialog from '@/hooks/useFeedbackDialog'

const FeedbackContext = createContext<FeedbackDialogState | null>(null)

export const useFeedback = () => {
  const context = useContext(FeedbackContext)

  if (!context) throw new Error('useFeedback must be used within a FeedbackProvider')

  return context
}

interface FeedbackProviderProps {
  children: ReactNode
}

export const FeedbackProvider = ({ children }: FeedbackProviderProps) => {
  const feedback = useFeedbackDialog()

  const defaultIconClass = classNames('text-[88px] mbe-5 sm:mbe-8', {
    'tabler-circle-check text-success': feedback.feedbackType === 'success',
    'tabler-circle-x text-error': feedback.feedbackType === 'error',
    'tabler-alert-triangle text-warning': feedback.feedbackType === 'warning',
    'tabler-info-circle text-info': feedback.feedbackType === 'info'
  })

  const iconToRender = feedback.customIcon ?? <i className={defaultIconClass} />

  const colorByType =
    feedback.feedbackType === 'success'
      ? 'success'
      : feedback.feedbackType === 'error'
        ? 'error'
        : feedback.feedbackType === 'warning'
          ? 'warning'
          : 'info'

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}

      <Dialog open={feedback.feedbackOpen} onClose={feedback.handleClose}>
        <DialogContent className='flex items-center flex-col text-center sm:pbs-16 sm:pbe-6 sm:pli-16'>
          {iconToRender}

          <Typography variant='h4' className='mbe-5'>
            {feedback.feedbackType.charAt(0).toUpperCase() + feedback.feedbackType.slice(1)}
          </Typography>

          <Typography color='text.primary'>{feedback.feedbackMessage}</Typography>
        </DialogContent>

        <DialogActions className='justify-center pbs-0 sm:pbe-16 sm:pli-16'>
          <Button variant='contained' color={colorByType as any} onClick={feedback.handleClose}>
            Ok
          </Button>
        </DialogActions>
      </Dialog>
    </FeedbackContext.Provider>
  )
}
