import { AdminUserDetailView } from '@/views/admin-users/AdminUserDetailView'

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <AdminUserDetailView id={id} />
}
