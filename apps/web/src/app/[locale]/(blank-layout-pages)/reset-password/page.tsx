import { Suspense } from 'react'

import ResetPasswordView from '@/views/auth/ResetPasswordView'

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordView />
    </Suspense>
  )
}
