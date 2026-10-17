// /blog/author/<slug>: an author's profile and their posts.
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
  const list = await getBlogPosts({ author: slug, page })

  return list?.author && page <= list.meta.totalPages ? { list, page, author: list.author } : null
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const hit = await load(props)

  if (!hit) return {}

  return blogMetadata({
    title: hit.author.name,
    description: hit.author.bio || `Posts by ${hit.author.name}.`,
    path: `/blog/author/${hit.author.slug}`,
    page: hit.page,
    ...(hit.author.avatarUrl ? { image: hit.author.avatarUrl } : {})
  })
}

export default async function AuthorPage(props: Props) {
  const [hit, taxonomy] = await Promise.all([load(props), getBlogTaxonomy()])

  if (!hit) {
    await reportNotFound(`/blog/author/${(await props.params).slug}`)
    notFound()
  }

  return (
    <BlogIndexView
      list={hit.list}
      taxonomy={{ categories: [], tags: taxonomy.tags }}
      base={`/blog/author/${hit.author.slug}`}
      title={hit.author.name}
      description={hit.author.bio || undefined}
      eyebrow={{ label: 'Blog', href: '/blog' }}
      author={hit.author}
    />
  )
}
