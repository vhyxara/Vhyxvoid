import { Suspense } from 'react'

import PerformanceView from '@/views/org/perf/PerformanceView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return (
    <Suspense>
      <PerformanceView accountId={accountId} />
    </Suspense>
  )
}
