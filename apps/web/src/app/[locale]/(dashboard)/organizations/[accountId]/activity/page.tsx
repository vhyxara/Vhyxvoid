import ActivityView from '@/views/org/activity/ActivityView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <ActivityView accountId={accountId} />
}
