import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { BlogList, BlogPost, BlogSummary } from '@/views/marketing/publicApi'

vi.mock('server-only', () => ({}))
vi.mock('@/views/marketing/publicApi', () => ({
  siteUrl: async () => 'https://example.test',
  getBootstrap: async () => ({ settings: { 'general.productName': 'Acme' }, footer: [] }),
  getBlogPosts: async () => ({ items: [summary({ title: 'Ship <fast> & "safe"', excerpt: 'Why & how' })], featured: null, category: null, tag: null, meta: { page: 1, limit: 20, total: 1, totalPages: 1 } })
}))

const { BlogIndexView, BlogPostView, pageHref, postJsonLd, scriptJson } = await import('./BlogViews')
const { pageParam } = await import('./meta')
const { GET: rss } = await import('@/app/blog/rss.xml/route')

function summary(over: Partial<BlogSummary> = {}): BlogSummary {
  return {
    slug: 'hello',
    title: 'Hello',
    excerpt: 'An intro',
    coverImageUrl: null,
    coverImageAlt: '',
    publishedAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
    readingMinutes: 4,
    authorName: 'Ada',
    featured: false,
    category: { slug: 'news', name: 'News' },
    tags: [{ slug: 'js', name: 'JS' }],
    ...over
  }
}

const list = (items: BlogSummary[], over: Partial<BlogList> = {}): BlogList => ({ items, featured: null, category: null, tag: null, meta: { page: 1, limit: 12, total: items.length, totalPages: 1 }, ...over })
const taxonomy = { categories: [{ slug: 'news', name: 'News', description: '', count: 2 }], tags: [] }

describe('the blog list', () => {
  it('leads with the featured post once, then the rest, with category chips', () => {
    const top = summary({ slug: 'top', title: 'Top story', featured: true })

    render(<BlogIndexView list={list([top, summary()], { featured: top })} taxonomy={taxonomy} base='/blog' title='Blog' />)
    expect(screen.getAllByRole('link', { name: 'Top story' })).toHaveLength(1)
    expect(screen.getByText('Featured')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Hello' }).getAttribute('href')).toBe('/blog/hello')
    expect(screen.getByRole('link', { name: 'All posts' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByText('4 min read')).toHaveLength(2)
  })

  it('pages with newer/older links and says when there is nothing, or the API is down', () => {
    const { rerender } = render(<BlogIndexView list={list([summary()], { meta: { page: 2, limit: 1, total: 3, totalPages: 3 } })} taxonomy={taxonomy} base='/blog/tag/js' title='#JS' />)

    expect(screen.getByRole('link', { name: '← Newer' }).getAttribute('href')).toBe('/blog/tag/js')
    expect(screen.getByRole('link', { name: 'Older →' }).getAttribute('href')).toBe('/blog/tag/js?page=3')
    rerender(<BlogIndexView list={list([])} taxonomy={taxonomy} base='/blog' title='Blog' />)
    expect(screen.getByText(/No posts here yet/)).toBeTruthy()
    rerender(<BlogIndexView list={null} taxonomy={taxonomy} base='/blog' title='Blog' />)
    expect(screen.getByText(/could not be loaded/)).toBeTruthy()
  })

  it('reads ?page= strictly', () => {
    expect(pageParam(undefined)).toBe(1)
    expect(pageParam('3')).toBe(3)
    expect(pageParam(['2', '5'])).toBe(2)
    expect(pageParam('0')).toBeNull()
    expect(pageParam('1.5')).toBeNull()
    expect(pageParam('abc')).toBeNull()
    expect(pageHref('/blog', 1)).toBe('/blog')
  })
})

describe('one post', () => {
  const post: BlogPost = { ...summary(), body: '## Section\n\nText with <script>alert(1)</script> and [a link](https://x.test).', seoTitle: null, seoDescription: null }

  it('renders the markdown without raw HTML, with tags and related posts', () => {
    const { container } = render(<BlogPostView post={post} related={[summary({ slug: 'other', title: 'Other post' })]} site='https://example.test' />)

    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy()
    expect(container.querySelector('article script')).toBeNull()
    expect(screen.getByRole('link', { name: '#JS' }).getAttribute('href')).toBe('/blog/tag/js')
    expect(screen.getByRole('link', { name: 'Other post' })).toBeTruthy()
  })

  it('describes itself to search engines without letting a title break out of the script tag', () => {
    const ld = postJsonLd({ ...post, title: '</script><b>x', coverImageUrl: '/images/a.png' }, 'https://example.test')

    expect(ld.url).toBe('https://example.test/blog/hello')
    expect(ld.image).toBe('https://example.test/images/a.png')
    expect(scriptJson(ld)).not.toContain('</script>')
    expect(JSON.parse(scriptJson(ld)).headline).toBe('</script><b>x')
  })
})

describe('the RSS feed', () => {
  it('lists posts with absolute links and escaped text', async () => {
    const res = await rss()
    const xml = await res.text()

    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    expect(xml).toContain('<title>Acme blog</title>')
    expect(xml).toContain('<link>https://example.test/blog/hello</link>')
    expect(xml).toContain('<title>Ship &lt;fast&gt; &amp; &quot;safe&quot;</title>')
    expect(xml).toContain('<description>Why &amp; how</description>')
    expect(xml).toContain('<category>News</category>')
  })
})
