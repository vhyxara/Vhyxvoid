'use client'
import { useState } from 'react'

import type { SubmitHandler } from 'react-hook-form'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Badge, Button, Dialog, TextField, TextareaField, Tooltip } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useSubmitFeedback } from '@/api/application/hooks/useFeedback'

import type { FeedbackFormValues } from '@/api/domain/identity/schemas/feedback.schema'
import { feedbackSchema } from '@/api/domain/identity/schemas/feedback.schema'
import type { FeedbackType } from '@/hooks/useFeedbackDialog'

// ── Type config (unchanged) ───────────────────────────────────────────────

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

// typeConfig.color is a plain MUI-style semantic name. VhyxUI's Badge has no
// 'error' variant (only default/success/warning/danger/info/outline) — same
// mapping pattern as every other Badge conversion this project has done.
function feedbackTypeBadgeVariant(color: 'error' | 'warning' | 'info' | 'success') {
  return color === 'error' ? ('danger' as const) : color
}

// For the dialog-title icon circle, which needs the raw CSS custom
// properties rather than a Badge variant — 'danger' is VhyxUI's token name
// for what this app calls 'error'.
function feedbackTypeColorToken(color: 'error' | 'warning' | 'info' | 'success') {
  return color === 'error' ? 'danger' : color
}

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

  const selectedType = useWatch({ control, name: 'type' }) as FeedbackType

  const isBug = selectedType === 'BUG_REPORT' || selectedType === 'UI_ISSUE'
  const typeConfig = FEEDBACK_TYPES.find(t => t.value === selectedType)
  const typeColorToken = typeConfig ? feedbackTypeColorToken(typeConfig.color) : 'accent'

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
      {/* ── FAB replacement ──
          Original wrapped this in <Zoom in unmountOnExit> — `in` was
          hardcoded true with no conditional anywhere in the component, so
          it only ever played a one-time mount animation and never actually
          toggled visibility based on real state. Confirmed dead, dropped
          entirely — see decision.md, 2026-09-16, "Phase 3 part 1". No
          VhyxUI Fab equivalent exists; Button iconOnly + fixed positioning
          is the same substitution Phase 1's ScrollToTopButton already
          established for this exact gap. 'lg' (48px) is the closest
          available Button size to MUI's Fab 'medium' (56px) — VhyxUI's
          Button size enum tops out at 'lg', it doesn't expose the larger
          'xl' spacing token. */}
      <Tooltip content='Send feedback' side='left'>
        <Button
          variant='primary'
          size='lg'
          iconOnly
          aria-label='Send feedback'
          icon={<i className='tabler-message-report text-xl' />}
          onClick={() => setOpen(true)}
          className='rounded-full'
          style={{
            position: 'fixed',
            bottom: 50,
            right: 24,
            zIndex: 1200,
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
          }}
        />
      </Tooltip>

      {/* ── Dialog ── */}
      <Dialog open={open} onOpenChange={next => !next && handleClose()} size='md'>
        {/* Dialog.Portal gates rendering on open state — see decision.md,
            2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: `var(--vhyx-color-${typeColorToken}-subtle)`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <i
                  className={typeConfig?.icon}
                  style={{ fontSize: 18, color: `var(--vhyx-color-${typeColorToken})` }}
                />
              </span>
              <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
                <span>Send feedback</span>
                <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)', fontWeight: 400 }}>
                  Help us improve VhyxVoid
                </Typography>
              </span>
            </Dialog.Title>

            <div className='flex flex-col gap-4' style={{ marginTop: 8 }}>
              {submitted ? (
                <div
                  className='flex flex-col items-center gap-3 text-center'
                  style={{ paddingTop: 32, paddingBottom: 32 }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      backgroundColor: 'var(--vhyx-color-success-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <i className='tabler-circle-check text-4xl text-success' />
                  </div>
                  <Typography variant='h6' style={{ fontWeight: 600 }}>
                    Thank you! 🎉
                  </Typography>
                  <Typography style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                    Your feedback has been submitted. We&apos;ll review it shortly.
                  </Typography>
                </div>
              ) : (
                <>
                  {/* ── Type selector ── */}
                  <div>
                    <Typography
                      variant='caption'
                      style={{ color: 'var(--vhyx-color-text-subtle)', marginBottom: 4, display: 'block' }}
                    >
                      What kind of feedback?
                    </Typography>
                    <div className='flex flex-wrap gap-2'>
                      {FEEDBACK_TYPES.map(t => {
                        const selected = selectedType === t.value

                        return (
                          <Controller
                            key={t.value}
                            name='type'
                            control={control}
                            render={({ field }) => (
                              <button
                                type='button'
                                onClick={() => field.onChange(t.value)}
                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                              >
                                <Badge variant={selected ? feedbackTypeBadgeVariant(t.color) : 'outline'} size='md'>
                                  <i className={t.icon} style={{ fontSize: 12, marginRight: 4 }} />
                                  {t.label}
                                </Badge>
                              </button>
                            )}
                          />
                        )
                      })}
                    </div>
                    {typeConfig && (
                      <Typography
                        variant='caption'
                        style={{ color: 'var(--vhyx-color-text-subtle)', marginTop: 6, display: 'block' }}
                      >
                        {typeConfig.description}
                      </Typography>
                    )}
                  </div>

                  {/* ── Title ── */}
                  <Controller
                    name='title'
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label='Title'
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
                        error={errors.title?.message}
                      />
                    )}
                  />

                  {/* ── Description — TextareaField, not TextField: VhyxUI has
                      no `multiline` prop on TextField the way MUI does, it's
                      a genuinely separate component for multi-line input. ── */}
                  <Controller
                    name='description'
                    control={control}
                    render={({ field }) => (
                      <TextareaField
                        {...field}
                        label='Description'
                        minRows={3}
                        placeholder='Describe your feedback in detail…'
                        error={errors.description?.message}
                      />
                    )}
                  />

                  {/* ── Bug-specific fields — shown only for BUG_REPORT and
                      UI_ISSUE. No VhyxUI Collapse equivalent exists; a plain
                      conditional render replaces the height-animated
                      Collapse, per decision.md, 2026-09-16, "Phase 3 part
                      1" (the animation was judged not worth a hand-rolled
                      shim for a cosmetic-only gain). ── */}
                  {isBug && (
                    <div className='flex flex-col gap-4'>
                      <Controller
                        name='stepsToReproduce'
                        control={control}
                        render={({ field }) => (
                          <TextareaField
                            {...field}
                            value={field.value ?? ''}
                            label='Steps to reproduce (optional)'
                            minRows={2}
                            placeholder={'1. Go to settings\n2. Click save\n3. See error'}
                            error={errors.stepsToReproduce?.message}
                          />
                        )}
                      />

                      <div className='flex gap-4'>
                        <div style={{ flex: 1 }}>
                          <Controller
                            name='expectedBehavior'
                            control={control}
                            render={({ field }) => (
                              <TextareaField
                                {...field}
                                value={field.value ?? ''}
                                label='Expected behavior'
                                minRows={2}
                                placeholder='What should have happened?'
                                error={errors.expectedBehavior?.message}
                              />
                            )}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <Controller
                            name='actualBehavior'
                            control={control}
                            render={({ field }) => (
                              <TextareaField
                                {...field}
                                value={field.value ?? ''}
                                label='Actual behavior'
                                minRows={2}
                                placeholder='What actually happened?'
                                error={errors.actualBehavior?.message}
                              />
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* No <form> element and a manual onClick-triggered
                handleSubmit on the Submit button — preserved exactly as-is
                rather than restructured onto VhyxUI's Form wrapper, per
                decision.md, 2026-09-16, "Phase 3 part 1". */}
            {!submitted && (
              <Dialog.Footer>
                <Button variant='secondary' onClick={handleClose} type='button'>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit(onSubmit)}
                  loading={submitFeedback.isPending}
                  icon={!submitFeedback.isPending ? <i className='tabler-send' /> : undefined}
                >
                  Submit feedback
                </Button>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  )
}
