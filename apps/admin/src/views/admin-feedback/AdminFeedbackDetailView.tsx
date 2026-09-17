'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Alert, Badge, Button, Card, Form, SelectField, Spinner, TextareaField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useAdminFeedbackDetail, useUpdateFeedback } from '@/api/application/hooks/useAdminFeedback'
import {
  FEEDBACK_PRIORITY_VALUES,
  FEEDBACK_STATUS_VALUES,
  type FeedbackPriority,
  type FeedbackStatus
} from '@/api/domain/admin-feedback/admin-feedback.types'

const schema = yup.object({
  status: yup.string().oneOf(FEEDBACK_STATUS_VALUES).required(),
  priority: yup.string().oneOf(FEEDBACK_PRIORITY_VALUES).required(),
  adminNotes: yup.string().optional().default('')
})

type FormValues = yup.InferType<typeof schema>

export function AdminFeedbackDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { data: feedback, isLoading, error } = useAdminFeedbackDetail(id)
  const updateFeedback = useUpdateFeedback(id)

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { status: 'OPEN', priority: 'MEDIUM', adminNotes: '' }
  })

  const { reset } = form

  useEffect(() => {
    if (feedback) reset({ status: feedback.status, priority: feedback.priority, adminNotes: feedback.adminNotes ?? '' })
  }, [feedback, reset])

  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  if (isLoading) {
    return (
      <div className='flex items-center justify-center p-12'>
        <Spinner size='lg' />
      </div>
    )
  }

  if (error) {
    return <Alert variant='danger'>{(error as Error).message}</Alert>
  }

  if (!feedback) return null

  // Always send status + priority together with adminNotes -- the route's
  // own "provide at least one field" 400 guard is then unreachable from
  // this UI. (That guard's error response is also shaped {error: "..."},
  // not this app's standard {success,message,code,data,requestId}
  // envelope -- confirmed via curl; a real backend inconsistency, not
  // something this screen needs to work around since it can't hit it.)
  const onSubmit = (values: FormValues) => {
    updateFeedback.mutate(
      {
        status: values.status as FeedbackStatus,
        priority: values.priority as FeedbackPriority,
        adminNotes: values.adminNotes
      },
      {
        onError: (err: any) => {
          toast.danger(err?.message ?? 'Failed to update feedback')
        }
      }
    )
  }

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center gap-3'>
        <Button
          variant='ghost'
          size='sm'
          iconOnly
          aria-label='Back'
          icon={<i className='tabler-arrow-left' />}
          onClick={() => router.push('/feedback')}
        />
        <Typography variant='h4'>{feedback.title}</Typography>
        <Badge variant='outline' size='sm'>
          {feedback.type.replaceAll('_', ' ')}
        </Badge>
      </div>

      <Card className='p-6 flex flex-col gap-3'>
        <Typography variant='h6'>Report</Typography>
        <Typography variant='body2'>{feedback.description}</Typography>

        {(feedback.stepsToReproduce || feedback.expectedBehavior || feedback.actualBehavior) && (
          <div className='flex flex-col gap-2' style={{ marginTop: 8 }}>
            {feedback.stepsToReproduce && (
              <div>
                <Typography variant='caption' style={{ fontWeight: 600 }}>
                  Steps to reproduce
                </Typography>
                <Typography variant='body2'>{feedback.stepsToReproduce}</Typography>
              </div>
            )}
            {feedback.expectedBehavior && (
              <div>
                <Typography variant='caption' style={{ fontWeight: 600 }}>
                  Expected behavior
                </Typography>
                <Typography variant='body2'>{feedback.expectedBehavior}</Typography>
              </div>
            )}
            {feedback.actualBehavior && (
              <div>
                <Typography variant='caption' style={{ fontWeight: 600 }}>
                  Actual behavior
                </Typography>
                <Typography variant='body2'>{feedback.actualBehavior}</Typography>
              </div>
            )}
          </div>
        )}

        <div className='flex gap-4 flex-wrap' style={{ marginTop: 8 }}>
          <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 12 }}>
            Submitted by: {feedback.userId}
          </Typography>
          <Typography variant='body2'>Submitted: {new Date(feedback.createdAt).toLocaleString()}</Typography>
          {feedback.resolvedAt && (
            <Typography variant='body2'>Resolved: {new Date(feedback.resolvedAt).toLocaleString()}</Typography>
          )}
          {feedback.pageUrl && <Typography variant='body2'>Page: {feedback.pageUrl}</Typography>}
          {feedback.appVersion && <Typography variant='body2'>App version: {feedback.appVersion}</Typography>}
        </div>

        {feedback.attachments.length > 0 && (
          <div className='flex gap-2 flex-wrap'>
            {feedback.attachments.map(url => (
              <a key={url} href={url} target='_blank' rel='noreferrer'>
                <Badge variant='outline' size='sm'>
                  Attachment
                </Badge>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card className='p-6 flex flex-col gap-4'>
        <Typography variant='h6'>Triage</Typography>

        {/* The documented status flow (OPEN -> UNDER_REVIEW -> IN_PROGRESS
            -> RESOLVED, or OPEN -> WONT_FIX/CLOSED) is NOT enforced by the
            backend -- confirmed by reading AdminUpdateFeedbackUseCase
            directly (status is set unconditionally, no transition check)
            and empirically. Every status is selectable regardless of the
            current one, matching what the backend actually allows. */}
        <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
          <div className='flex gap-4 flex-wrap'>
            <div style={{ minWidth: 200 }}>
              <SelectField
                name='status'
                label='Status'
                value={form.watch('status')}
                onValueChange={value => form.setValue('status', value as FeedbackStatus, { shouldDirty: true })}
                options={FEEDBACK_STATUS_VALUES.map(value => ({ label: value.replaceAll('_', ' '), value }))}
              />
            </div>

            <div style={{ minWidth: 200 }}>
              <SelectField
                name='priority'
                label='Priority'
                value={form.watch('priority')}
                onValueChange={value => form.setValue('priority', value as FeedbackPriority, { shouldDirty: true })}
                options={FEEDBACK_PRIORITY_VALUES.map(value => ({ label: value, value }))}
              />
            </div>
          </div>

          <TextareaField label='Admin notes' placeholder='Internal notes, not visible to the submitter' {...form.register('adminNotes')} />

          <Button type='submit' size='sm' style={{ alignSelf: 'flex-start' }} loading={loading || updateFeedback.isPending}>
            Save changes
          </Button>
        </Form>
      </Card>
    </div>
  )
}
