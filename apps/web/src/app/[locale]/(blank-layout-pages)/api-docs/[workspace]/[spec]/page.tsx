import type { Metadata } from 'next'

import PublicDocsView from '@/views/apidocs/PublicDocsView'

type Props = { params: Promise<{ workspace: string; spec: string }> }

export const metadata: Metadata = { title: 'API docs' }

export default async function Page({ params }: Props) {
  const { workspace, spec } = await params

  return <PublicDocsView workspace={decodeURIComponent(workspace)} slug={decodeURIComponent(spec)} />
}
