import InboxView from '@/views/org/inbox/InboxView'

type Props = { params: Promise<{ accountId: string }> }

export default async function InboxPage({ params }: Props) {
  const { accountId } = await params

  return <InboxView accountId={accountId} />
}
