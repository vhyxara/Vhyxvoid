'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { Button } from '@vhyxui/react'

import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

const VerifyEmailSentView = () => {
  const email = useSearchParams().get('email')

  return (
    <AuthShell art={AUTH_ART.verify}>
      <div className={`flex flex-col gap-4 ${styles.center}`}>
        <span className={styles.status} aria-hidden>
          ✉
        </span>
        <div>
          <h1 className={styles.title}>Check your inbox</h1>
          <p className={styles.lead}>
            We sent a verification link to {email ? <strong style={{ color: '#f4f3ff' }}>{email}</strong> : 'your email address'}. Open it to activate your account.
          </p>
        </div>
      </div>
      <p className={styles.fine} style={{ textAlign: 'center' }}>
        Nothing arrived? Check your spam folder, or <Link href='/register'>sign up with another address</Link>.
      </p>
      <Button asChild style={{ width: '100%' }}>
        <Link href='/login'>Back to sign in</Link>
      </Button>
    </AuthShell>
  )
}

export default VerifyEmailSentView
