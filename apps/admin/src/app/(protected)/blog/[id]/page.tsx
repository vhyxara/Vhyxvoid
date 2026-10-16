import { BlogPostEditorView } from '@/views/blog/BlogPostEditorView'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return <BlogPostEditorView id={id} />
}
