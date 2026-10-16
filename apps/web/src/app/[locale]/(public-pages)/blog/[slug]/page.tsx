import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { BlogPostView } from '@/views/blog/BlogViews'
import { blogMetadata } from '@/views/blog/meta'
import { getBlogPost, siteUrl } from '@/views/marketing/publicApi'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const hit = await getBlogPost((await params).slug)

  if (!hit || 'redirect' in hit) return {}
  const { post } = hit
  const description = post.seoDescription || post.excerpt || undefined
  const meta = await blogMetadata({ title: post.seoTitle || post.title, description, path: `/blog/${post.slug}` })
  const images = post.coverImageUrl ? [{ url: post.coverImageUrl, alt: post.coverImageAlt || post.title }] : undefined

  return {
    ...meta,
    openGraph: { ...meta.openGraph, type: 'article', publishedTime: post.publishedAt, modifiedTime: post.updatedAt, authors: post.authorName ? [post.authorName] : undefined, section: post.category?.name, tags: post.tags.map(t => t.name), images },
    twitter: { ...meta.twitter, images: images?.map(i => i.url) }
  }
}

export default async function BlogPostPage({ params }: Props) {
  const hit = await getBlogPost((await params).slug)

  if (!hit) notFound()
  // The post was renamed: send readers and search engines to its address now.
  if ('redirect' in hit) permanentRedirect(`/blog/${hit.redirect}`)

  return <BlogPostView post={hit.post} related={hit.related} site={await siteUrl()} />
}
