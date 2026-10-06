import { Suspense } from 'react'

import { PlansPricingView } from '@/views/plans/PlansPricingView'

export default function Page() {
  return (
    <Suspense>
      <PlansPricingView />
    </Suspense>
  )
}
