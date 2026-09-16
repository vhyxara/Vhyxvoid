'use client'
import { useState } from 'react'

import type { SubmitHandler } from 'react-hook-form'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import Fab from '@mui/material/Fab'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import Collapse from '@mui/material/Collapse'
import Zoom from '@mui/material/Zoom'

import CustomTextField from '@core/components/mui/TextField'
import { useSubmitFeedback } from '@/api/application/hooks/useFeedback'

// import type { FeedbackType } from '@/hooks/useFeedbackDialog'
import type { FeedbackFormValues } from '@/api/domain/identity/schemas/feedback.schema'
import { feedbackSchema } from '@/api/domain/identity/schemas/feedback.schema'
import type { FeedbackType } from '@/hooks/useFeedbackDialog'

// ── Type config ───────────────────────────────────────────────────────────

// Replace the type annotation on FEEDBACK_TYPES
const FEEDBACK_TYPES: Array<{
  value: FeedbackType
  label: string
  icon: string
  color: 'error' | 'warning' | 'info' | 'success'
  description: string
}> = [
  {
    value: 'BUG_REPORT' as FeedbackType,
    label: 'Bug report',
    icon: 'tabler-bug',
    color: 'error',
    description: 'Something is broken or not working as expected'
  },
  {
    value: 'FEATURE_REQUEST' as FeedbackType,
    label: 'Feature request',
    icon: 'tabler-bulb',
    color: 'warning',
    description: 'Suggest a new feature or improvement'
  },
  {
    value: 'UI_ISSUE' as FeedbackType,
    label: 'UI issue',
    icon: 'tabler-layout',
    color: 'info',
    description: 'Visual or layout problem in the interface'
  },
  {
    value: 'GENERAL_FEEDBACK' as FeedbackType,
    label: 'General feedback',
    icon: 'tabler-message-circle',
    color: 'success',
    description: 'Share your thoughts or suggestions'
  }
]

// ── Component ─────────────────────────────────────────────────────────────

export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submitFeedback = useSubmitFeedback()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FeedbackFormValues>({
    resolver: yupResolver(feedbackSchema),
    defaultValues: {
      type: 'BUG_REPORT',
      title: '',
      description: '',
      stepsToReproduce: '',
      expectedBehavior: '',
      actualBehavior: ''
    }
  })

  // const selectedType = watch('type') as FeedbackType
  const selectedType = useWatch({ control, name: 'type' }) as FeedbackType

  const isBug = selectedType === 'BUG_REPORT' || selectedType === 'UI_ISSUE'
  const typeConfig = FEEDBACK_TYPES.find(t => t.value === selectedType)

  const handleClose = () => {
    if (submitFeedback.isPending) return
    setOpen(false)

    // Delay reset so user doesn't see fields clear while dialog animates out
    setTimeout(() => {
      reset()
      setSubmitted(false)
    }, 300)
  }

  const onSubmit: SubmitHandler<FeedbackFormValues> = values => {
    submitFeedback.mutate(
      {
        type: values.type as FeedbackType,
        title: values.title,
        description: values.description,
        stepsToReproduce: values.stepsToReproduce || null,
        expectedBehavior: values.expectedBehavior || null,
        actualBehavior: values.actualBehavior || null
      },
      {
        onSuccess: () => {
          setSubmitted(true)
          setTimeout(handleClose, 2000)
        }
      }
    )
  }

  return (
    <>
      {/* ── FAB ── */}
      <Zoom in unmountOnExit>
        <Tooltip title='Send feedback' placement='left'>
          <Fab
            size='medium'
            color='primary'
            onClick={() => setOpen(true)}
            sx={{
              position: 'fixed',
              bottom: 50,
              right: 24,
              zIndex: 1200,
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}
          >
            <i className='tabler-message-report text-xl' />
          </Fab>
        </Tooltip>
      </Zoom>

      {/* ── Dialog ── */}
      <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 2,
                bgcolor: `${typeConfig?.color}.lighter`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <i
                className={typeConfig?.icon}
                style={{ fontSize: 18, color: `var(--mui-palette-${typeConfig?.color}-main)` }}
              />
            </Box>
            <Box>
              <Typography variant='h6' fontWeight={600} lineHeight={1.2}>
                Send feedback
              </Typography>
              <Typography variant='caption' color='text.secondary'>
                Help us improve VhyxVoid
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '8px !important' }}>
          {submitted ? (
            <Box
              sx={{
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                textAlign: 'center'
              }}
            >
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  bgcolor: 'success.lighter',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i className='tabler-circle-check text-4xl text-success' />
              </Box>
              <Typography variant='h6' fontWeight={600}>
                Thank you! 🎉
              </Typography>
              <Typography color='text.secondary'>
                Your feedback has been submitted. We&apos;ll review it shortly.
              </Typography>
            </Box>
          ) : (
            <>
              {/* ── Type selector ── */}
              <Box>
                <Typography variant='caption' color='text.secondary' sx={{ mb: 1, display: 'block' }}>
                  What kind of feedback?
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {FEEDBACK_TYPES.map(t => {
                    const selected = selectedType === t.value

                    return (
                      <Controller
                        key={t.value}
                        name='type'
                        control={control}
                        render={({ field }) => (
                          <Chip
                            icon={<i className={t.icon} style={{ fontSize: 14 }} />}
                            label={t.label}
                            onClick={() => field.onChange(t.value)}
                            color={selected ? t.color : 'default'}
                            variant={selected ? 'filled' : 'outlined'}
                            size='small'
                            sx={{ cursor: 'pointer', fontWeight: selected ? 600 : 400 }}
                          />
                        )}
                      />
                    )
                  })}
                </Box>
                {typeConfig && (
                  <Typography variant='caption' color='text.secondary' sx={{ mt: 0.75, display: 'block' }}>
                    {typeConfig.description}
                  </Typography>
                )}
              </Box>

              {/* ── Title ── */}
              <Controller
                name='title'
                control={control}
                render={({ field }) => (
                  <CustomTextField
                    {...field}
                    label='Title'
                    fullWidth
                    autoFocus
                    placeholder={
                      selectedType === 'BUG_REPORT'
                        ? 'e.g. App crashes when clicking submit'
                        : selectedType === 'FEATURE_REQUEST'
                          ? 'e.g. Add dark mode support'
                          : selectedType === 'UI_ISSUE'
                            ? 'e.g. Button misaligned on mobile'
                            : 'e.g. Great experience overall'
                    }
                    error={!!errors.title}
                    helperText={errors.title?.message}
                  />
                )}
              />

              {/* ── Description ── */}
              <Controller
                name='description'
                control={control}
                render={({ field }) => (
                  <CustomTextField
                    {...field}
                    label='Description'
                    fullWidth
                    multiline
                    rows={3}
                    placeholder='Describe your feedback in detail…'
                    error={!!errors.description}
                    helperText={errors.description?.message}
                  />
                )}
              />

              {/* ── Bug-specific fields — shown only for BUG_REPORT and UI_ISSUE ── */}
              <Collapse in={isBug} unmountOnExit>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Controller
                    name='stepsToReproduce'
                    control={control}
                    render={({ field }) => (
                      <CustomTextField
                        {...field}
                        value={field.value ?? ''}
                        label='Steps to reproduce (optional)'
                        fullWidth
                        multiline
                        rows={2}
                        placeholder={'1. Go to settings\n2. Click save\n3. See error'}
                        error={!!errors.stepsToReproduce}
                        helperText={errors.stepsToReproduce?.message}
                      />
                    )}
                  />

                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Controller
                      name='expectedBehavior'
                      control={control}
                      render={({ field }) => (
                        <CustomTextField
                          {...field}
                          value={field.value ?? ''}
                          label='Expected behavior'
                          fullWidth
                          multiline
                          rows={2}
                          placeholder='What should have happened?'
                          error={!!errors.expectedBehavior}
                          helperText={errors.expectedBehavior?.message}
                        />
                      )}
                    />
                    <Controller
                      name='actualBehavior'
                      control={control}
                      render={({ field }) => (
                        <CustomTextField
                          {...field}
                          value={field.value ?? ''}
                          label='Actual behavior'
                          fullWidth
                          multiline
                          rows={2}
                          placeholder='What actually happened?'
                          error={!!errors.actualBehavior}
                          helperText={errors.actualBehavior?.message}
                        />
                      )}
                    />
                  </Box>
                </Box>
              </Collapse>
            </>
          )}
        </DialogContent>

        {!submitted && (
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button onClick={handleClose} variant='outlined' color='secondary'>
              Cancel
            </Button>
            <LoadingButton
              onClick={handleSubmit(onSubmit)}
              loading={submitFeedback.isPending}
              variant='contained'
              startIcon={!submitFeedback.isPending && <i className='tabler-send' />}
            >
              Submit feedback
            </LoadingButton>
          </DialogActions>
        )}
      </Dialog>
    </>
  )
}
