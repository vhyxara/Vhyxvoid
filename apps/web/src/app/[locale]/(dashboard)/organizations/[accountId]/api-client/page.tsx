import ApiClientView from '@/views/org/apiclient/ApiClientView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <ApiClientView accountId={accountId} />
}
