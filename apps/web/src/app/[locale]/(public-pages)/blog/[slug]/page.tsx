import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { BlogPostView } from '@/views/blog/BlogViews'
import { blogMetadata } from '@/views/blog/meta'
import { getBlogPost, siteUrl } from '@/views/marketing/publicApi'
import { reportNotFound } from '@/views/seo/seo'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const hit = await getBlogPost((await params).slug)

  if (!hit || 'redirect' in hit) return {}
  const { post } = hit

  return blogMetadata({
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    path: `/blog/${post.slug}`,
    image: post.coverImageUrl,
    imageAlt: post.coverImageAlt,
    type: 'article',
    extra: {
      authors: post.authorName ? [{ name: post.authorName }] : undefined,
      keywords: post.tags.map(t => t.name),
      openGraph: { type: 'article', publishedTime: post.publishedAt, modifiedTime: post.updatedAt, authors: post.authorName ? [post.authorName] : undefined, section: post.category?.name, tags: post.tags.map(t => t.name) }
    }
  })
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const hit = await getBlogPost(slug)

  if (!hit) {
    await reportNotFound(`/blog/${slug}`)
    notFound()
  }

  // The post was renamed: send readers and search engines to its address now.
  if ('redirect' in hit) permanentRedirect(`/blog/${hit.redirect}`)

  return <BlogPostView post={hit.post} related={hit.related} site={await siteUrl()} />
}
