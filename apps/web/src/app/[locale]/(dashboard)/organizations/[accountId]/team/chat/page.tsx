import { Suspense } from 'react'

import ChatView from '@/views/org/team/ChatView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return (
    <Suspense>
      <ChatView accountId={accountId} />
    </Suspense>
  )
}
