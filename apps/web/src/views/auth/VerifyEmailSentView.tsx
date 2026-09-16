'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { styled } from '@mui/material/styles'

import { Button } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'
import Logo from '@/libs/layout/shared/Logo'

const Illustration = styled('img')({
  maxWidth: 320,
  width: '100%',
  marginBottom: 32
})

const VerifyEmailSentView = ({ mode }: { mode: SystemMode }) => {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? 'your email'

  return (
    <div className='flex justify-center items-center min-bs-dvh bg-backgroundPaper p-6'>
      <div className='flex flex-col items-center gap-6 max-is-[480px] text-center'>
        <Link href='/' className='self-start'>
          <Logo />
        </Link>

        <Illustration
          src={
            mode === 'dark'
              ? '/images/illustrations/auth/v2-verify-email-dark.png'
              : '/images/illustrations/auth/v2-verify-email-light.png'
          }
          alt='verify email illustration'
        />

        <div className='flex flex-col gap-2'>
          <Typography variant='h4'>Check your inbox ✉️</Typography>
          <Typography variant='body1'>
            We sent a verification link to{' '}
            <strong style={{ color: 'var(--vhyx-color-text)' }}>{email}</strong>. Click the link in the email to
            activate your account.
          </Typography>
          <Typography variant='body2' style={{ marginTop: 8 }}>
            Didn&apos;t receive it? Check your spam folder or{' '}
            <Link href='/register' className='text-primary'>
              try another email address
            </Link>
            .
          </Typography>
        </div>

        <Button asChild style={{ width: '100%' }}>
          <Link href='/login'>Back to login</Link>
        </Button>
      </div>
    </div>
  )
}

export default VerifyEmailSentView
