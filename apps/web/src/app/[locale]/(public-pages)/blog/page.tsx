import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlogIndexView } from '@/views/blog/BlogViews'
import { blogMetadata, pageParam } from '@/views/blog/meta'
import { getBlogPosts, getBlogTaxonomy } from '@/views/marketing/publicApi'

type Props = { searchParams: Promise<{ page?: string | string[] }> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return blogMetadata({ title: 'Blog', description: 'News, guides and updates from the team.', path: '/blog', page: pageParam((await searchParams).page) ?? 1 })
}

export default async function BlogPage({ searchParams }: Props) {
  const page = pageParam((await searchParams).page)

  if (!page) notFound()
  const [list, taxonomy] = await Promise.all([getBlogPosts({ page }), getBlogTaxonomy()])

  if (list && page > list.meta.totalPages) notFound()

  return <BlogIndexView list={list} taxonomy={taxonomy} base='/blog' title='Blog' description='News, guides and updates from the team.' />
}
