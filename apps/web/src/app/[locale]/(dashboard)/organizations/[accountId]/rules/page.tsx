import { Suspense } from 'react'

import TrafficRulesView from '@/views/org/rules/TrafficRulesView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  // useSearchParams (inspector hand-off) needs a Suspense boundary.
  return (
    <Suspense>
      <TrafficRulesView accountId={accountId} />
    </Suspense>
  )
}
