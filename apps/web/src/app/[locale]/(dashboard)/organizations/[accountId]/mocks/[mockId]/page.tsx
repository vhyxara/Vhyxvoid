import MockEditorView from '@/views/org/mocks/MockEditorView'

type Props = { params: Promise<{ accountId: string; mockId: string }> }

export default async function Page({ params }: Props) {
  const { accountId, mockId } = await params

  return <MockEditorView accountId={accountId} mockId={mockId} />
}
