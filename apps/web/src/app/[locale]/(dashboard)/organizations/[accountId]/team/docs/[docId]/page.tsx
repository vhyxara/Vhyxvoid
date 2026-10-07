import DocView from '@/views/org/team/DocView'

type Props = { params: Promise<{ accountId: string; docId: string }> }

export default async function Page({ params }: Props) {
  const { accountId, docId } = await params

  return <DocView accountId={accountId} docId={docId} />
}
