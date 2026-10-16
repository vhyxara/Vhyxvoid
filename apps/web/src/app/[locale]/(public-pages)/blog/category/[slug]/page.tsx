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
  const list = await getBlogPosts({ category: slug, page })

  return list?.category && page <= list.meta.totalPages ? { list, page, category: list.category } : null
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const hit = await load(props)

  if (!hit) return {}

  return blogMetadata({ title: hit.category.name, description: hit.category.description || `Posts in ${hit.category.name}.`, path: `/blog/category/${hit.category.slug}`, page: hit.page })
}

export default async function CategoryPage(props: Props) {
  const [hit, taxonomy] = await Promise.all([load(props), getBlogTaxonomy()])

  if (!hit) {
    await reportNotFound(`/blog/category/${(await props.params).slug}`)
    notFound()
  }

  return (
    <BlogIndexView
      list={hit.list}
      taxonomy={taxonomy}
      base={`/blog/category/${hit.category.slug}`}
      title={hit.category.name}
      description={hit.category.description || undefined}
      eyebrow={{ label: 'Blog', href: '/blog' }}
      activeCategory={hit.category.slug}
    />
  )
}
