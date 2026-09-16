'use client'
import { useState } from 'react'

import Link from 'next/link'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import { styled, useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import classnames from 'classnames'

import { Alert, Button, Form, TextField } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'
import Logo from '@/libs/layout/shared/Logo'
import { useImageVariant } from '@core/hooks/useImageVariant'
import { useSettings } from '@core/hooks/useSettings'
import type { ForgotPasswordFormValues } from '@/api/domain/identity/schemas/password.schema'
import { forgotPasswordSchema } from '@/api/domain/identity/schemas/password.schema'
import { passwordService } from '@/api/infrastructure/services/password.service'

const Illustration = styled('img')(({ theme }) => ({
  zIndex: 2,
  blockSize: 'auto',
  maxBlockSize: 680,
  maxInlineSize: '100%',
  margin: theme.spacing(12),
  [theme.breakpoints.down(1536)]: { maxBlockSize: 550 },
  [theme.breakpoints.down('lg')]: { maxBlockSize: 450 }
}))

const MaskImg = styled('img')({
  blockSize: 'auto',
  maxBlockSize: 355,
  inlineSize: '100%',
  position: 'absolute',
  insetBlockEnd: 0,
  zIndex: -1
})

export default function ForgotPasswordView({ mode }: { mode: SystemMode }) {
  const [sent, setSent] = useState(false)

  const { settings } = useSettings()
  const theme = useTheme()
  const hidden = useMediaQuery(theme.breakpoints.down('md'))

  const darkImg = '/images/pages/auth-mask-dark.png'
  const lightImg = '/images/pages/auth-mask-light.png'
  const darkIllustration = '/images/illustrations/auth/v2-forgot-password-dark.png'
  const lightIllustration = '/images/illustrations/auth/v2-forgot-password-light.png'
  const borderedDark = '/images/illustrations/auth/v2-forgot-password-dark-border.png'
  const borderedLight = '/images/illustrations/auth/v2-forgot-password-light-border.png'

  const authBackground = useImageVariant(mode, lightImg, darkImg)
  const characterIllustration = useImageVariant(mode, lightIllustration, darkIllustration, borderedLight, borderedDark)

  const form = useForm<ForgotPasswordFormValues>({
    resolver: yupResolver(forgotPasswordSchema),
    defaultValues: { email: '' }
  })

  const onSubmit = async ({ email }: ForgotPasswordFormValues) => {
    try {
      await passwordService.forgotPassword({ email })
    } catch {
      // Intentionally silent — anti-enumeration
      // We NEVER reveal whether the email exists
    } finally {
      // Always show the same message regardless of outcome
      setSent(true)
    }
  }

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction".
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as ForgotPasswordFormValues)
  const loading = form.formState.isSubmitting

  return (
    <div className='flex bs-full justify-center'>
      {/* Left panel */}
      <div
        className={classnames('flex bs-full items-center justify-center flex-1 min-bs-dvh relative p-6 max-md:hidden', {
          'border-ie': settings.skin === 'bordered'
        })}
      >
        <Illustration src={characterIllustration} alt='forgot-password-illustration' />
        {!hidden && (
          <MaskImg
            alt='mask'
            src={authBackground}
            className={classnames({ 'scale-x-[-1]': theme.direction === 'rtl' })}
          />
        )}
      </div>

      {/* Right panel */}
      <div className='flex justify-center items-center bs-full bg-backgroundPaper min-is-full! p-6 md:min-is-[unset]! md:p-12 md:is-[480px]'>
        <Link href='/' className='absolute block-start-5 sm:block-start-[33px] inline-start-6 sm:start-[38px]'>
          <Logo />
        </Link>

        <div className='flex flex-col gap-6 is-full sm:is-auto md:is-full sm:max-is-[400px] md:max-is-[unset] mbs-11 sm:mbs-14 md:mbs-0'>
          <div className='flex flex-col gap-1'>
            <Typography variant='h4'>Forgot your password? 🔒</Typography>
            <Typography variant='body2'>Enter your email and we&apos;ll send you a reset link.</Typography>
          </div>

          {sent ? (
            <div className='flex flex-col gap-5'>
              <Alert variant='success' icon={<i className='tabler-mail-check' />}>
                If an account with that email exists, a reset link has been sent. Check your inbox — the link expires in
                1 hour.
              </Alert>
              <Typography variant='body2' style={{ textAlign: 'center' }}>
                Didn&apos;t receive it? Check your spam folder or{' '}
                <span
                  style={{ color: 'var(--vhyx-color-accent)', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setSent(false)}
                >
                  try again
                </span>
                .
              </Typography>
              <Button asChild variant='outline' style={{ width: '100%' }}>
                <Link href='/login'>Back to login</Link>
              </Button>
            </div>
          ) : (
            <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-5'>
              <TextField label='Email address' type='email' autoFocus {...form.register('email')} />

              <Button type='submit' loading={loading} style={{ width: '100%' }}>
                Send reset link
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
