'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Form, TextField } from '@vhyxui/react'

import { resetPasswordSchema, type ResetPasswordFormValues } from '@/api/domain/identity/schemas/password.schema'
import { passwordService } from '@/api/infrastructure/services/password.service'
import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

export default function ResetPasswordView() {
  const token = useSearchParams().get('token') ?? ''
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const form = useForm<ResetPasswordFormValues>({
    resolver: yupResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' }
  })

  const onSubmit = async ({ newPassword }: ResetPasswordFormValues) => {
    setErrorMsg('')

    try {
      await passwordService.resetPassword({ token, newPassword })
      setSuccess(true)
      // A moment to read the confirmation, then sign in with the new password.
      setTimeout(() => window.location.replace('/login'), 2000)
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Reset failed. The link may have expired.')
    }
  }

  const untypedForm = form as any

  void form.formState.errors

  return (
    <AuthShell art={AUTH_ART.recover}>
      <div>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.lead}>At least 8 characters, with letters, numbers and a symbol.</p>
      </div>

      {!token && (
        <Alert variant='danger'>
          This link is incomplete. <Link href='/forgot-password'>Ask for a new one</Link>.
        </Alert>
      )}
      {errorMsg && <Alert variant='danger'>{errorMsg}</Alert>}

      {success ? (
        <Alert variant='success'>Your password is changed. Taking you to sign in…</Alert>
      ) : (
        <Form form={untypedForm} onSubmit={(data: any) => onSubmit(data as ResetPasswordFormValues)} className='flex flex-col gap-5'>
          <TextField label='New password' type='password' autoComplete='new-password' autoFocus {...form.register('newPassword')} />
          <TextField label='Confirm new password' type='password' autoComplete='new-password' {...form.register('confirmPassword')} />
          <Button type='submit' loading={form.formState.isSubmitting} disabled={!token} style={{ width: '100%' }}>
            Save new password
          </Button>
          <p className={styles.row}>
            <Link href='/login'>← Back to sign in</Link>
          </p>
        </Form>
      )}
    </AuthShell>
  )
}
