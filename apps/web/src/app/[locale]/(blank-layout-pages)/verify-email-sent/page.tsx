import { Suspense } from 'react'

import VerifyEmailSentView from '@/views/auth/VerifyEmailSentView'

export default function VerifyEmailSentPage() {
  return (
    <Suspense>
      <VerifyEmailSentView />
    </Suspense>
  )
}
