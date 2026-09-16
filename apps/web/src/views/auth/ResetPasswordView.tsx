'use client'
import { useState } from 'react'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Form, TextField, toast } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'
import Logo from '@/libs/layout/shared/Logo'
import { useImageVariant } from '@core/hooks/useImageVariant'
import { useSettings } from '@core/hooks/useSettings'
import { AuthIllustrationPanel } from './AuthIllustrationPanel'
import type { ResetPasswordFormValues } from '@/api/domain/identity/schemas/password.schema'
import { resetPasswordSchema } from '@/api/domain/identity/schemas/password.schema'
import { passwordService } from '@/api/infrastructure/services/password.service'

export default function ResetPasswordView({ mode }: { mode: SystemMode }) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const { settings } = useSettings()

  const darkImg = '/images/pages/auth-mask-dark.png'
  const lightImg = '/images/pages/auth-mask-light.png'
  const darkIllustration = '/images/illustrations/auth/v2-reset-password-dark.png'
  const lightIllustration = '/images/illustrations/auth/v2-reset-password-light.png'
  const borderedDark = '/images/illustrations/auth/v2-reset-password-dark-border.png'
  const borderedLight = '/images/illustrations/auth/v2-reset-password-light-border.png'

  const authBackground = useImageVariant(mode, lightImg, darkImg)
  const characterIllustration = useImageVariant(mode, lightIllustration, darkIllustration, borderedLight, borderedDark)

  const form = useForm<ResetPasswordFormValues>({
    resolver: yupResolver(resetPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' }
  })

  const onSubmit = async ({ newPassword }: ResetPasswordFormValues) => {
    if (!token) {
      setErrorMsg('Invalid reset link. Please request a new one.')

      return
    }

    setErrorMsg('')

    try {
      await passwordService.resetPassword({ token, newPassword })
      setSuccess(true)
      toast.success('Password reset successfully. Please log in.')

      // Redirect after brief delay so user reads the success
      setTimeout(() => {
        window.location.replace('/login')
      }, 2000)
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Reset failed. The link may have expired.')
    }
  }

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction".
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as ResetPasswordFormValues)
  const loading = form.formState.isSubmitting

  return (
    <div className='flex bs-full justify-center'>
      {/* Left panel */}
      <AuthIllustrationPanel
        characterSrc={characterIllustration}
        characterAlt='reset-password-illustration'
        maskSrc={authBackground}
        bordered={settings.skin === 'bordered'}
      />

      {/* Right panel */}
      <div className='flex justify-center items-center bs-full bg-backgroundPaper min-is-full! p-6 md:min-is-[unset]! md:p-12 md:is-[480px]'>
        <Link href='/' className='absolute block-start-5 sm:block-start-[33px] inline-start-6 sm:start-[38px]'>
          <Logo />
        </Link>

        <div className='flex flex-col gap-6 is-full sm:is-auto md:is-full sm:max-is-[400px] md:max-is-[unset] mbs-11 sm:mbs-14 md:mbs-0'>
          <div className='flex flex-col gap-1'>
            <Typography variant='h4'>Reset your password 🔑</Typography>
            <Typography variant='body2'>Choose a strong new password for your account.</Typography>
          </div>

          {!token && (
            <Alert variant='danger'>
              Invalid reset link. Please{' '}
              <Link href='/forgot-password' style={{ color: 'inherit', fontWeight: 500 }}>
                request a new one
              </Link>
              .
            </Alert>
          )}

          {errorMsg && <Alert variant='danger'>{errorMsg}</Alert>}

          {success ? (
            <Alert variant='success' icon={<i className='tabler-circle-check' />}>
              Password reset successfully. Redirecting to login…
            </Alert>
          ) : (
            <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-5'>
              <TextField label='New password' type='password' autoFocus {...form.register('newPassword')} />

              <TextField
                label='Confirm new password'
                type='password'
                {...form.register('confirmPassword')}
              />

              {/* Password strength hint */}
              <Typography variant='caption'>
                Use at least 8 characters with a mix of letters, numbers, and symbols.
              </Typography>

              <Button type='submit' loading={loading} disabled={!token} style={{ width: '100%' }}>
                Reset password
              </Button>

              <Button asChild variant='link' style={{ justifyContent: 'center' }}>
                <Link href='/login'>
                  <i className='tabler-arrow-left text-sm' /> Back to login
                </Link>
              </Button>
            </Form>
          )}
        </div>
      </div>
    </div>
  )
}
