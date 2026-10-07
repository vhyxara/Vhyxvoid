import CollectionWorkspaceView from '@/views/org/apiclient/CollectionWorkspaceView'

type Props = { params: Promise<{ accountId: string; collectionId: string }> }

export default async function Page({ params }: Props) {
  const { accountId, collectionId } = await params

  return <CollectionWorkspaceView accountId={accountId} collectionId={collectionId} />
}
