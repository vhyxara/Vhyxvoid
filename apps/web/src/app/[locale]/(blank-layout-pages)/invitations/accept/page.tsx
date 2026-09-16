import { Suspense } from 'react'

import { getSystemMode } from '@core/utils/serverHelpers'
import { AcceptInvitationView } from '@/views/org/AcceptInvitationView'

export default async function AcceptInvitationPage() {
  const systemMode = await getSystemMode()

  return (
    <Suspense>
      <AcceptInvitationView mode={systemMode} />
    </Suspense>
  )
}
