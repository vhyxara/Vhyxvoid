import TunnelAccessView from '@/views/org/access/TunnelAccessView'

type Props = { params: Promise<{ accountId: string }> }

export default async function TunnelAccessPage({ params }: Props) {
  const { accountId } = await params

  return <TunnelAccessView accountId={accountId} />
}
