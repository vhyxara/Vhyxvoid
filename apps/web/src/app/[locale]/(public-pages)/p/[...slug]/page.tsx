import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import type { PageContent } from '@vhyxvoid/content'

import { MarkdownPage } from '@/views/marketing/MarkdownPage'
import { getContent } from '@/views/marketing/publicApi'

type Props = { params: Promise<{ slug: string[] }> }

async function load(params: Props['params']) {
  const { slug } = await params
  const entry = await getContent<PageContent>(slug.join('/'))

  return entry && entry.kind === 'page' ? entry : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await load(params)

  return entry ? { title: entry.seoTitle || `${entry.title} — VhyxVoid`, description: entry.seoDescription ?? undefined } : {}
}

export default async function CmsPage({ params }: Props) {
  const entry = await load(params)

  if (!entry) notFound()

  return <MarkdownPage body={entry.data.body} />
}
