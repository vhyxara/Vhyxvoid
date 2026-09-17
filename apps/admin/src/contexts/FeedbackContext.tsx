'use client'

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react'

import { Button, Dialog } from '@vhyxui/react'
import classNames from 'classnames'

import { Typography } from '@/components/vhyxui-shims'

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

  // Button has no per-semantic-type color (only primary/secondary/outline/
  // ghost/destructive/link) — 'error' maps onto the real 'destructive'
  // variant; the other three types get an inline accent-color override on
  // top of 'primary', same targeted-override pattern as CreateApiKeyDialog's
  // selected-Badge accent color.
  const accentColorByType: Partial<Record<typeof feedback.feedbackType, string>> = {
    success: 'var(--vhyx-color-success)',
    warning: 'var(--vhyx-color-warning)',
    info: 'var(--vhyx-color-info)'
  }

  const accentColor = accentColorByType[feedback.feedbackType]
  const okButtonStyle = accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}

      <Dialog open={feedback.feedbackOpen} onOpenChange={next => !next && feedback.handleClose()} size='sm'>
        {/* Dialog.Portal gates rendering on open state — see decision.md,
            2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className='flex items-center flex-col text-center sm:pbs-16 sm:pbe-6 sm:pli-16'>
            {/* Cross-repo ReactNode type-identity mismatch (same class of
                issue as Confirmation.tsx's `content as any`), not a real
                type error. */}
            {iconToRender as any}

            <Dialog.Title className='mbe-5'>
              {feedback.feedbackType.charAt(0).toUpperCase() + feedback.feedbackType.slice(1)}
            </Dialog.Title>

            <Typography style={{ color: 'var(--vhyx-color-text)' }}>{feedback.feedbackMessage}</Typography>

            {/* Inline justifyContent (not a className) — Dialog.Footer's own
                CSS-module class already sets justify-content: flex-end at
                equal specificity to a Tailwind utility class, so only an
                inline style is guaranteed to win regardless of stylesheet
                load order. */}
            <Dialog.Footer
              className='pbs-0 sm:pbe-16 sm:pli-16'
              style={{ justifyContent: 'center' }}
            >
              <Button
                variant={feedback.feedbackType === 'error' ? 'destructive' : 'primary'}
                style={okButtonStyle}
                onClick={feedback.handleClose}
              >
                Ok
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </FeedbackContext.Provider>
  )
}
