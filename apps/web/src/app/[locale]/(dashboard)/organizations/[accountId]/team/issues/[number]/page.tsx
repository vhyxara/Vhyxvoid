import { notFound } from 'next/navigation'

import IssueView from '@/views/org/team/IssueView'

type Props = { params: Promise<{ accountId: string; number: string }> }

export default async function Page({ params }: Props) {
  const { accountId, number } = await params
  const n = Number(number)

  if (!Number.isInteger(n) || n < 1) notFound()

  return <IssueView accountId={accountId} number={n} />
}
