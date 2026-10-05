import { Suspense } from 'react'

import { BillingView } from '@/views/billing/BillingView'

export default function Page() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  )
}
