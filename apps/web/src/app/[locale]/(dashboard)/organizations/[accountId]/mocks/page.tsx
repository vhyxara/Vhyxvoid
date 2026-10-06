import MocksView from '@/views/org/mocks/MocksView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <MocksView accountId={accountId} />
}
