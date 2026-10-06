import InspectorView from '@/views/org/inspector/InspectorView'

type Props = { params: Promise<{ accountId: string }> }

export default async function InspectorPage({ params }: Props) {
  const { accountId } = await params

  return <InspectorView accountId={accountId} />
}
