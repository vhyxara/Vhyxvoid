'use client'
import { useEffect } from 'react'

import { useSearchParams } from 'next/navigation'

import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'

import { useVerifyEmail } from '../../api/application/hooks/useVerifyEmail'

// Token arrives as ?token=xxx query param from the email link.
// Auto-fires on mount — user just clicks the link, no manual action needed.
export function VerifyEmailForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const verify = useVerifyEmail()

  useEffect(() => {
    if (token) verify.mutate(token)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return <Alert severity='error'>Invalid verification link. Please check your email and try again.</Alert>
  }

  if (verify.isPending) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CircularProgress size={20} />
        <Typography>Verifying your email…</Typography>
      </div>
    )
  }

  if (verify.isError) {
    return <Alert severity='error'>Verification failed. The link may have expired. Please request a new one.</Alert>
  }

  return <Alert severity='success'>Email verified. Redirecting to login…</Alert>
}
