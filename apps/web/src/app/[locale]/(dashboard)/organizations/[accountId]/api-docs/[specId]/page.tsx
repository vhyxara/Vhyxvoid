import { Suspense } from 'react'

import SpecWorkspaceView from '@/views/org/specs/SpecWorkspaceView'

type Props = { params: Promise<{ accountId: string; specId: string }> }

export default async function Page({ params }: Props) {
  const { accountId, specId } = await params

  return (
    <Suspense>
      <SpecWorkspaceView accountId={accountId} specId={specId} />
    </Suspense>
  )
}
