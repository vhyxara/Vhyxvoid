import { Suspense } from 'react'

import { getSystemMode } from '@core/utils/serverHelpers'
import ForgotPasswordView from '@/views/auth/ForgotPasswordView'

export default async function ForgotPasswordPage() {
  const systemMode = await getSystemMode()

  return (
    <Suspense>
      <ForgotPasswordView mode={systemMode} />
    </Suspense>
  )
}
