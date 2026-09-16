import { Suspense } from 'react'

import { getSystemMode } from '@core/utils/serverHelpers'
import ResetPasswordView from '@/views/auth/ResetPasswordView'

export default async function ResetPasswordPage() {
  const systemMode = await getSystemMode()

  return (
    <Suspense>
      <ResetPasswordView mode={systemMode} />
    </Suspense>
  )
}
