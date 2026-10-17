'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Form, TextField } from '@vhyxui/react'

import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/api/domain/identity/schemas/password.schema'
import { passwordService } from '@/api/infrastructure/services/password.service'
import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

export default function ForgotPasswordView() {
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotPasswordFormValues>({
    resolver: yupResolver(forgotPasswordSchema),
    defaultValues: { email: '' }
  })

  const onSubmit = async ({ email }: ForgotPasswordFormValues) => {
    try {
      await passwordService.forgotPassword({ email })
    } catch {
      // Silent on purpose: the page never says whether an address has an account.
    } finally {
      setSent(true)
    }
  }

  const untypedForm = form as any

  return (
    <AuthShell art={AUTH_ART.recover}>
      <div>
        <h1 className={styles.title}>Forgot your password?</h1>
        <p className={styles.lead}>Enter your email and we’ll send you a link to choose a new one.</p>
      </div>

      {sent ? (
        <div className='flex flex-col gap-4'>
          <Alert variant='success'>If an account uses that address, a reset link is on its way. It works for 1 hour.</Alert>
          <p className={styles.fine}>
            Nothing arrived? Check your spam folder, or{' '}
            <button type='button' className={styles.textButton} onClick={() => setSent(false)}>
              try again
            </button>
            .
          </p>
          <Button asChild variant='outline' style={{ width: '100%' }}>
            <Link href='/login'>Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <Form form={untypedForm} onSubmit={(data: any) => onSubmit(data as ForgotPasswordFormValues)} className='flex flex-col gap-5'>
          <TextField label='Email' type='email' autoComplete='email' placeholder='you@company.com' autoFocus {...form.register('email')} />
          <Button type='submit' loading={form.formState.isSubmitting} style={{ width: '100%' }}>
            Send reset link
          </Button>
          <p className={styles.row}>
            <Link href='/login'>← Back to sign in</Link>
          </p>
        </Form>
      )}
    </AuthShell>
  )
}
