import { AdminFeedbackDetailView } from '@/views/admin-feedback/AdminFeedbackDetailView'

export default async function AdminFeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <AdminFeedbackDetailView id={id} />
}
