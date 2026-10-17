import { Suspense } from 'react'

import ForgotPasswordView from '@/views/auth/ForgotPasswordView'

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordView />
    </Suspense>
  )
}
