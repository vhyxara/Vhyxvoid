import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BlogIndexView } from '@/views/blog/BlogViews'
import { blogMetadata, pageParam } from '@/views/blog/meta'
import { getBlogPosts, getBlogTaxonomy } from '@/views/marketing/publicApi'
import { reportNotFound } from '@/views/seo/seo'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string | string[] }> }

async function load({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams])
  const page = pageParam(sp.page)

  if (!page) return null
  const list = await getBlogPosts({ tag: slug, page })

  return list?.tag && page <= list.meta.totalPages ? { list, page, tag: list.tag } : null
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const hit = await load(props)

  if (!hit) return {}

  // Tag pages overlap the category pages and the list; keep them out of search results.
  return blogMetadata({ title: `#${hit.tag.name}`, description: `Posts tagged ${hit.tag.name}.`, path: `/blog/tag/${hit.tag.slug}`, page: hit.page, noindex: true })
}

export default async function TagPage(props: Props) {
  const [hit, taxonomy] = await Promise.all([load(props), getBlogTaxonomy()])

  if (!hit) {
    await reportNotFound(`/blog/tag/${(await props.params).slug}`)
    notFound()
  }

  return <BlogIndexView list={hit.list} taxonomy={taxonomy} base={`/blog/tag/${hit.tag.slug}`} title={`#${hit.tag.name}`} description={`Posts tagged ${hit.tag.name}.`} eyebrow={{ label: 'Blog', href: '/blog' }} />
}
