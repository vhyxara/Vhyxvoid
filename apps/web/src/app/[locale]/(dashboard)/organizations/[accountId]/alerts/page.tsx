import AlertsView from '@/views/org/alerts/AlertsView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <AlertsView accountId={accountId} />
}
