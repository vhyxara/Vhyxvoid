import DocsView from '@/views/org/team/DocsView'

type Props = { params: Promise<{ accountId: string }> }

export default async function Page({ params }: Props) {
  const { accountId } = await params

  return <DocsView accountId={accountId} />
}
