'use client'

import { useEffect, useState } from 'react'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { Alert, Button, Spinner } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'
import Logo from '@/libs/layout/shared/Logo'
import { authService } from '@/api/infrastructure/services/auth.service'

type Status = 'idle' | 'loading' | 'success' | 'error'

const VerifyEmailView = ({ mode }: { mode: SystemMode }) => {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) return

    setStatus('loading')

    authService
      .verifyEmail(token)
      .then(() => {
        setStatus('success')

        // Small delay so user reads the success message before redirect
        setTimeout(() => {
          window.location.replace('/login?verified=1')
        }, 2000)
      })
      .catch((err: any) => {
        setStatus('error')
        setErrorMsg(err?.message ?? 'Verification failed.')
      })
  }, [token])

  return (
    <div className='flex justify-center items-center min-bs-dvh bg-backgroundPaper p-6'>
      <div className='flex flex-col items-center gap-6 max-is-[480px] text-center'>
        <Link href='/' className='self-start'>
          <Logo />
        </Link>

        <img
          src={
            mode === 'dark'
              ? '/images/illustrations/auth/v2-verify-email-dark.png'
              : '/images/illustrations/auth/v2-verify-email-light.png'
          }
          alt='verify email'
          className='max-is-[320px] is-full mbe-6'
        />

        {!token && (
          <Alert variant='danger' style={{ width: '100%' }}>
            Invalid verification link. Please check your email and try again.
          </Alert>
        )}

        {status === 'loading' && (
          <div className='flex flex-col items-center gap-3'>
            <Spinner size='md' />
            <Typography variant='body1'>Verifying your email…</Typography>
          </div>
        )}

        {status === 'success' && (
          <div className='flex flex-col gap-2'>
            <Typography variant='h4'>Email verified! ✅</Typography>
            <Typography variant='body1'>Your account is now active. Redirecting you to login…</Typography>
          </div>
        )}

        {status === 'error' && (
          <div className='flex flex-col gap-4 w-full'>
            <Alert variant='danger'>{errorMsg}</Alert>
            <Typography variant='body2'>The link may have expired. Links are valid for 24 hours.</Typography>
            <Button asChild variant='outline' style={{ width: '100%' }}>
              <Link href='/register'>Register again</Link>
            </Button>
            <Button asChild style={{ width: '100%' }}>
              <Link href='/login'>Back to login</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default VerifyEmailView
