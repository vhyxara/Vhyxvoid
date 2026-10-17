'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { Alert, Button, Spinner } from '@vhyxui/react'

import { authService } from '@/api/infrastructure/services/auth.service'
import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

type Status = 'loading' | 'success' | 'error'

const VerifyEmailView = () => {
  const token = useSearchParams().get('token') ?? ''
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('This link is incomplete. Open it straight from the email.')

      return
    }

    authService
      .verifyEmail(token)
      .then(() => {
        setStatus('success')
        // A moment to read the confirmation, then sign in.
        setTimeout(() => window.location.replace('/login?verified=1'), 2000)
      })
      .catch((err: any) => {
        setStatus('error')
        setErrorMsg(err?.message ?? 'Verification failed.')
      })
  }, [token])

  return (
    <AuthShell art={AUTH_ART.verify}>
      <div className={`flex flex-col gap-4 ${styles.center}`}>
        <span className={styles.status} data-tone={status === 'success' ? 'ok' : status === 'error' ? 'bad' : undefined} aria-hidden>
          {status === 'loading' ? <Spinner size='md' /> : status === 'success' ? '✓' : '!'}
        </span>
        <div role='status'>
          <h1 className={styles.title}>{status === 'loading' ? 'Verifying your email…' : status === 'success' ? 'Email verified' : 'That link didn’t work'}</h1>
          {status === 'success' && <p className={styles.lead}>Your account is active. Taking you to sign in…</p>}
        </div>
      </div>
      {status === 'error' && (
        <div className='flex flex-col gap-3'>
          <Alert variant='danger'>{errorMsg}</Alert>
          <p className={styles.fine}>Verification links work for 24 hours. Signing up again with the same address sends a fresh one.</p>
          <Button asChild variant='outline' style={{ width: '100%' }}>
            <Link href='/register'>Sign up again</Link>
          </Button>
          <Button asChild style={{ width: '100%' }}>
            <Link href='/login'>Back to sign in</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  )
}

export default VerifyEmailView
