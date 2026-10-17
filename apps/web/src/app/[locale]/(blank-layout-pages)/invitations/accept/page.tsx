import { Suspense } from 'react'

import { AcceptInvitationView } from '@/views/org/AcceptInvitationView'

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitationView />
    </Suspense>
  )
}
