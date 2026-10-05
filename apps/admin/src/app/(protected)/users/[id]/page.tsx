import { UserDetailView } from '@/views/users/UserDetailView'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <UserDetailView id={id} />
}
