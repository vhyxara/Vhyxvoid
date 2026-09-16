'use client'
import { useEffect } from 'react'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Badge, Button, Card, Form, Separator, TextField } from '@vhyxui/react'

import { Avatar, Typography } from '@/components/vhyxui-shims'
import { useMyProfile } from '@/api/application/hooks/useMe'
import { useUpdateProfile } from '@/api/application/hooks/useOrg'
import ChangePasswordView from './ChangePasswordView'
import { FeedbackHistoryTab } from './FeedbackHistoryTab'

const schema = yup.object({
  firstName: yup.string().min(1, 'Required').required('First name is required'),
  lastName: yup.string().min(1, 'Required').required('Last name is required')
})

type FormValues = yup.InferType<typeof schema>

export default function ProfileView() {
  const { data: profile } = useMyProfile()
  const updateProfile = useUpdateProfile()

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { firstName: '', lastName: '' }
  })

  const { reset, formState } = form

  // Also read `errors` (even though it's never used directly — Field reads
  // it via context on its own) so this component re-renders on every RHF
  // formState change, not just isDirty/isSubmitting. Without this, a field
  // that revalidates clean while typing (RHF's default onChange
  // reValidateMode) leaves its OLD error message stuck on screen until the
  // next submit, since nothing here was subscribed to `errors` itself. See
  // decision.md, 2026-09-10, "Step 4: Form/Field error-display requires
  // reading formState.isSubmitting" (and its follow-up correction).
  void formState.errors

  // Populate form once profile loads
  useEffect(() => {
    if (profile) {
      reset({
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? ''
      })
    }
  }, [profile, reset])

  const onSubmit = (values: FormValues) => {
    updateProfile.mutate(values)
  }

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" —
  // VhyxUI's <Form> types `form` against its own separately-installed
  // react-hook-form, a cross-repo type-identity mismatch with no properly-
  // typed cast target. Reused verbatim from the Step 2 template.
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  const initials =
    profile?.firstName && profile?.lastName
      ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
      : (profile?.email?.[0]?.toUpperCase() ?? '?')

  return (
    <div className='flex flex-col gap-6 max-w-[640px] mx-auto'>
      {/* ── Identity card ── */}
      <Card>
        <div className='flex items-center gap-4 py-2'>
          <Avatar size='lg' style={{ width: 72, height: 72, fontSize: 24 }}>
            {initials}
          </Avatar>

          <div className='flex-1'>
            <Typography variant='h6'>{profile?.fullName ?? '—'}</Typography>
            <Typography variant='body2'>{profile?.email ?? ''}</Typography>
            <div className='mt-2'>
              <Badge variant={profile?.isEmailVerified ? 'success' : 'warning'} size='sm'>
                {profile?.isEmailVerified ? 'Email verified' : 'Email not verified'}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Edit profile form ── */}
      <Card>
        <div className='flex flex-col gap-4'>
          <div>
            <Typography variant='subtitle1'>Personal information</Typography>
            <Typography variant='body2'>
              Update your display name. Email changes require a separate verification flow.
            </Typography>
          </div>

          <Separator />

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <div className='grid grid-cols-2 gap-4'>
              <TextField label='First name' {...form.register('firstName')} />
              <TextField label='Last name' {...form.register('lastName')} />
            </div>

            {/* Email — read-only, shown for reference */}
            <TextField
              name='email'
              label='Email address'
              value={profile?.email ?? ''}
              disabled
              hint='Email changes are not available yet'
            />

            <div className='flex justify-end'>
              {/* VhyxUI's Form/Field error display only refreshes when some
                  ancestor of <Form> is subscribed to a react-hook-form
                  formState field that changes on submit — Field's own
                  context read doesn't by itself trigger a re-render (see
                  decision.md, 2026-09-10, "Step 4: Form/Field error-display
                  requires reading formState.isSubmitting"). Reading
                  isSubmitting here (matching the Login/Register template)
                  is what makes failed-validation errors actually appear. */}
              <Button
                type='submit'
                loading={formState.isSubmitting || updateProfile.isPending}
                disabled={!formState.isDirty}
              >
                Save changes
              </Button>
            </div>
          </Form>
        </div>
      </Card>

      {/* ── Organizations membership summary ── */}
      <Card>
        <Typography variant='subtitle1'>Organization memberships</Typography>
        <Typography variant='body2'>
          {profile ? `Member of ${(profile as any).accounts?.length ?? 0} organization(s)` : '—'}
        </Typography>
      </Card>

      <ChangePasswordView />

      {/* FeedbackHistoryTab is a real GenericServerTable-based list screen,
          not a "simple content page" element — left fully MUI-internal,
          out of scope for Step 4. See decision.md, 2026-09-10, "Step 4
          scope correction: profile and org-settings pages embed real
          list/CRUD screens the original brief didn't account for". */}
      <FeedbackHistoryTab />
    </div>
  )
}
