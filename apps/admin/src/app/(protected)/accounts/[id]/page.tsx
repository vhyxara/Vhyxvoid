import { AccountDetailView } from '@/views/accounts/AccountDetailView'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <AccountDetailView id={id} />
}
