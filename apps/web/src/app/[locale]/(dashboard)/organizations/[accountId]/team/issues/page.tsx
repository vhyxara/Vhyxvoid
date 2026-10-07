import { Suspense } from 'react'

import IssuesView from '@/views/org/team/IssuesView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return (
    <Suspense>
      <IssuesView accountId={accountId} />
    </Suspense>
  )
}
