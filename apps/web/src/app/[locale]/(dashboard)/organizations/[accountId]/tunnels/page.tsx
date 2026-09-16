import TunnelsView from '@/views/org/tunnels/TunnelsView'

type Props = { params: Promise<{ accountId: string }> }

export default async function TunnelsPage({ params }: Props) {
  const { accountId } = await params

  return <TunnelsView accountId={accountId} />
}
