import BillingView from '@/views/org/billing/BillingView'

type Props = { params: Promise<{ accountId: string }> }

export default async function BillingPage({ params }: Props) {
  const { accountId } = await params

  return <BillingView accountId={accountId} />
}
