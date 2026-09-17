import { AdminRoleDetailView } from '@/views/admin-roles/AdminRoleDetailView'

export default async function AdminRoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <AdminRoleDetailView id={id} />
}
