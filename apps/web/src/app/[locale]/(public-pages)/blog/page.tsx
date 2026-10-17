import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlogIndexView } from '@/views/blog/BlogViews'
import { blogMetadata, pageParam } from '@/views/blog/meta'
import { getBlogPosts, getBlogTaxonomy } from '@/views/marketing/publicApi'

type Props = { searchParams: Promise<{ page?: string | string[]; q?: string | string[] }> }

const DESCRIPTION = 'News, guides and updates from the team.'

/** The search box's words: one value, trimmed, at most 100 characters. */
const searchParam = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) || undefined

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams
  const q = searchParam(sp.q)

  // Search results aren't pages of their own for search engines: noindex, canonical /blog.
  if (q) return blogMetadata({ title: `Search: ${q}`, description: DESCRIPTION, path: '/blog', noindex: true })

  return blogMetadata({ title: 'Blog', description: DESCRIPTION, path: '/blog', page: pageParam(sp.page) ?? 1 })
}

export default async function BlogPage({ searchParams }: Props) {
  const sp = await searchParams
  const page = pageParam(sp.page)
  const q = searchParam(sp.q)

  if (!page) notFound()
  const [list, taxonomy] = await Promise.all([getBlogPosts({ page, ...(q ? { q } : {}) }), getBlogTaxonomy()])

  if (list && list.meta.total > 0 && page > list.meta.totalPages) notFound()

  return <BlogIndexView list={list} taxonomy={taxonomy} base='/blog' title={q ? 'Search the blog' : 'Blog'} description={q ? undefined : DESCRIPTION} search={q} />
}
