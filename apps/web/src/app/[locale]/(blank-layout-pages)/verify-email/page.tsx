import { Suspense } from 'react'

import VerifyEmailView from '@/views/auth/VerifyEmailView'

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailView />
    </Suspense>
  )
}
