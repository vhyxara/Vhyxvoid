'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { Alert, Button, Spinner } from '@vhyxui/react'

import { memberService } from '@/api/infrastructure/services/member.service'
import { AUTH_ART, AuthShell } from '@/views/auth/AuthShell'
import styles from '@/views/auth/AuthShell.module.css'

type Status = 'loading' | 'success' | 'error'

export function AcceptInvitationView() {
  const token = useSearchParams().get('token') ?? ''
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('This invitation link is incomplete. Open it straight from the email.')

      return
    }

    memberService
      .acceptInvitation({ token })
      .then(() => {
        setStatus('success')
        // A moment to read the confirmation, then into the dashboard.
        setTimeout(() => window.location.replace('/dashboard'), 2000)
      })
      .catch((err: any) => {
        setStatus('error')
        setErrorMsg(err?.message ?? 'Could not accept the invitation.')
      })
  }, [token])

  return (
    <AuthShell art={AUTH_ART.invite}>
      <div className={`flex flex-col gap-4 ${styles.center}`}>
        <span className={styles.status} data-tone={status === 'success' ? 'ok' : status === 'error' ? 'bad' : undefined} aria-hidden>
          {status === 'loading' ? <Spinner size='md' /> : status === 'success' ? '✓' : '!'}
        </span>
        <div role='status'>
          <h1 className={styles.title}>{status === 'loading' ? 'Accepting your invitation…' : status === 'success' ? 'You’re in' : 'That invitation didn’t work'}</h1>
          {status === 'success' && <p className={styles.lead}>You’ve joined the team. Taking you to the dashboard…</p>}
        </div>
      </div>
      {status === 'error' && (
        <div className='flex flex-col gap-3'>
          <Alert variant='danger'>{errorMsg}</Alert>
          <p className={styles.fine}>Invitations work for 3 days and once. Ask whoever invited you to send a new one.</p>
          <Button asChild style={{ width: '100%' }}>
            <Link href='/dashboard'>Go to the dashboard</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
