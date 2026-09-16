'use client'
import { useEffect, useState } from 'react'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { styled } from '@mui/material/styles'

import { Alert, Button, Spinner } from '@vhyxui/react'

// import { useAcceptInvitation } from '@/application/hooks/useMembers'
import Logo from '@/@core/svg/Logo'
import type { SystemMode } from '@/@core/types'
import { Typography } from '@/components/vhyxui-shims'
import { memberService } from '@/api/infrastructure/services/member.service'

type Status = 'idle' | 'loading' | 'success' | 'error'

const Illustration = styled('img')({
  maxWidth: 280,
  width: '100%',
  marginBottom: 24
})

type Props = { mode: SystemMode }

export function AcceptInvitationView({ mode }: Props) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    setStatus('loading')

    memberService
      .acceptInvitation({ token })
      .then(res => {
        setOrgId(res.accountId)
        setStatus('success')

        // Navigate into the org after a brief pause so user reads the success
        setTimeout(() => {
          window.location.replace(`/dashboard`)
        }, 2000)
      })
      .catch((err: any) => {
        setStatus('error')
        setErrorMsg(err?.message ?? 'Could not accept invitation.')
      })
  }, [token])

  return (
    <div className='flex justify-center items-center min-bs-dvh bg-backgroundPaper p-6'>
      <div className='flex flex-col items-center gap-6 max-is-[440px] text-center'>
        <Link href='/' className='self-start'>
          <Logo />
        </Link>

        <Illustration
          src={
            mode === 'dark'
              ? '/images/illustrations/auth/v2-verify-email-dark.png'
              : '/images/illustrations/auth/v2-verify-email-light.png'
          }
          alt='invitation'
        />

        {!token && (
          <Alert variant='danger' style={{ width: '100%' }}>
            Invalid invitation link. Please check your email and try again.
          </Alert>
        )}

        {status === 'loading' && (
          <div className='flex flex-col items-center gap-3'>
            <Spinner size='md' />
            <Typography variant='body1'>Accepting your invitation…</Typography>
          </div>
        )}

        {status === 'success' && (
          <div className='flex flex-col gap-2'>
            <Typography variant='h5'>You&apos;re in! 🎉</Typography>
            <Typography variant='body1'>You&apos;ve joined the organization. Redirecting to your dashboard…</Typography>
            <Typography variant='body1'>
              Organization ID: <code>{orgId}</code>
            </Typography>
          </div>
        )}

        {status === 'error' && (
          <div className='flex flex-col gap-4 w-full'>
            <Alert variant='danger'>{errorMsg}</Alert>
            <Typography variant='body2'>
              The invitation may have expired (links are valid for 3 days) or already been used.
            </Typography>
            <Button asChild style={{ width: '100%' }}>
              <Link href='/dashboard'>Go to dashboard</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
