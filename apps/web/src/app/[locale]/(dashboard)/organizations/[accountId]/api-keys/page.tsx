import ApiKeysView from '@/views/org/api-keys/ApiKeysView'

type Props = { params: Promise<{ accountId: string }> }

export default async function ApiKeysPage({ params }: Props) {
  const { accountId } = await params

  return <ApiKeysView accountId={accountId} />
}
