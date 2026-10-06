import DomainsView from '@/views/org/domains/DomainsView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <DomainsView accountId={accountId} />
}
