'use client'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Card, Form, Separator, TextField } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useChangePassword } from '@/api/application/hooks/usePassword'
import type { ChangePasswordFormValues } from '@/api/domain/identity/schemas/password.schema'
import { changePasswordSchema } from '@/api/domain/identity/schemas/password.schema'

export default function ChangePasswordView() {
  const changePassword = useChangePassword()

  const form = useForm<ChangePasswordFormValues>({
    resolver: yupResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    }
  })

  const { reset, formState } = form

  // See decision.md, 2026-09-10, "Step 4: Form/Field error-display requires
  // reading formState.isSubmitting" (and its follow-up correction) — also
  // read `errors` so this re-renders on live onChange revalidation, not
  // just isDirty/isSubmitting transitions.
  void formState.errors

  const onSubmit = ({ currentPassword, newPassword }: ChangePasswordFormValues) => {
    changePassword.mutate(
      { currentPassword, newPassword },
      { onError: () => reset({ currentPassword: '', newPassword: '', confirmPassword: '' }) }
    )
  }

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" —
  // reused verbatim from the Step 2 template.
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as ChangePasswordFormValues)

  return (
    <Card>
      <div className='flex flex-col gap-4'>
        {/* Header */}
        <div>
          <Typography variant='subtitle1'>Change password</Typography>
          <Typography variant='body2'>
            After changing your password you will be logged out of all devices and need to sign in again.
          </Typography>
        </div>

        <Separator />

        {/* Security notice */}
        <Alert variant='info' icon={<i className='tabler-shield-lock' />}>
          All active sessions will be revoked immediately when you change your password.
        </Alert>

        {/* type="password" on VhyxUI's Input/TextField already includes a
            built-in show/hide toggle — no need to hand-roll the
            IconButton/InputAdornment state MUI required. */}
        <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
          <TextField
            label='Current password'
            type='password'
            autoComplete='current-password'
            {...form.register('currentPassword')}
          />

          <TextField
            label='New password'
            type='password'
            autoComplete='new-password'
            hint='Minimum 8 characters'
            {...form.register('newPassword')}
          />

          <TextField
            label='Confirm new password'
            type='password'
            autoComplete='new-password'
            {...form.register('confirmPassword')}
          />

          <div className='flex justify-end mt-1'>
            {/* Reading formState.isSubmitting here is what makes VhyxUI's
                Form/Field error display refresh after a failed validation —
                see decision.md, 2026-09-10, "Step 4: Form/Field error-
                display requires reading formState.isSubmitting". */}
            <Button
              type='submit'
              loading={formState.isSubmitting || changePassword.isPending}
              disabled={!formState.isDirty}
            >
              Update password
            </Button>
          </div>
        </Form>
      </div>
    </Card>
  )
}
