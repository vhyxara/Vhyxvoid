// The blog's pages: the list (all posts, a category or a tag) and one post.
// Server components; data comes from publicApi.ts (cached under the "cms" tag,
// refreshed the moment an admin publishes). Post bodies are markdown rendered
// without raw HTML, so a post can't run scripts.
import Link from 'next/link'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { BlogList, BlogPost, BlogSummary, BlogTaxonomy } from '@/views/marketing/publicApi'
import { JsonLd, breadcrumbJsonLd, scriptJson } from '@/views/seo/JsonLd'
import { PostToc, ShareBar } from './PostExtras'
import { headingsOf, rehypeHeadingIds } from './toc'
import styles from './blog.module.css'

export const formatPostDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** A link to a page of a list, keeping page 1 at the bare address (and the search, if any). */
export function pageHref(base: string, page: number, q?: string) {
  const qs = new URLSearchParams()

  if (q) qs.set('q', q)
  if (page > 1) qs.set('page', String(page))

  return qs.size ? `${base}?${qs}` : base
}

function Meta({ post }: { post: BlogSummary }) {
  return (
    <div className={styles.meta}>
      {post.authorName && <span>{post.authorName}</span>}
      {post.authorName && <span aria-hidden>·</span>}
      <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
    </div>
  )
}

export function PostCard({ post, featured = false }: { post: BlogSummary; featured?: boolean }) {
  return (
    <article className={`${styles.card} ${featured ? styles.featured : ''}`}>
      {post.coverImageUrl ? <img src={post.coverImageUrl} alt={post.coverImageAlt} className={styles.cover} loading={featured ? 'eager' : 'lazy'} /> : <span className={styles.coverEmpty} aria-hidden />}
      <div className={styles.cardBody}>
        {featured && <span className={styles.featuredLabel}>Featured</span>}
        {post.category && (
          <Link href={`/blog/category/${post.category.slug}`} className={styles.cardCategory}>
            {post.category.name}
          </Link>
        )}
        {featured ? (
          <h2 className={styles.cardTitle}>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
          </h2>
        ) : (
          <h3 className={styles.cardTitle}>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
          </h3>
        )}
        {post.excerpt && <p className={styles.cardExcerpt}>{post.excerpt}</p>}
        <Meta post={post} />
      </div>
    </article>
  )
}

function Pager({ base, page, totalPages, q }: { base: string; page: number; totalPages: number; q?: string }) {
  if (totalPages <= 1) return null

  return (
    <nav className={styles.pager} aria-label='Pages'>
      {page > 1 ? (
        <Link href={pageHref(base, page - 1, q)} rel='prev'>
          ← Newer
        </Link>
      ) : (
        <span aria-disabled>← Newer</span>
      )}
      <span>
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={pageHref(base, page + 1, q)} rel='next'>
          Older →
        </Link>
      ) : (
        <span aria-disabled>Older →</span>
      )}
    </nav>
  )
}

export function BlogIndexView({
  list,
  taxonomy,
  base,
  title,
  description,
  eyebrow,
  activeCategory,
  search
}: {
  list: BlogList | null
  taxonomy: BlogTaxonomy
  /** The list's own address, e.g. /blog or /blog/tag/js. */
  base: string
  title: string
  description?: string
  eyebrow?: { label: string; href: string }
  activeCategory?: string
  /** What the reader searched for (on /blog), if anything. */
  search?: string
}) {
  const featured = list?.featured ?? null
  const items = (list?.items ?? []).filter(p => p.slug !== featured?.slug)
  const page = list?.meta.page ?? 1

  return (
    <section className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          {eyebrow && (
            <Link href={eyebrow.href} className={styles.eyebrow}>
              {eyebrow.label}
            </Link>
          )}
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.lead}>{description}</p>}
          {base === '/blog' && (
            <form action='/blog' method='get' role='search' className={styles.search}>
              <input type='search' name='q' defaultValue={search} placeholder='Search posts' aria-label='Search posts' maxLength={100} />
              <button type='submit'>Search</button>
            </form>
          )}
        </header>
        {search && (
          <p className={styles.searchNote} role='status'>
            {list?.meta.total ? list.meta.total === 1 ? '1 post matches' : `${list.meta.total} posts match` : 'Nothing matches'} “{search}”. <Link href='/blog'>Clear the search</Link>
          </p>
        )}
        {taxonomy.categories.length > 0 && (
          <ul className={styles.chips} aria-label='Categories'>
            <li>
              <Link href='/blog' className={styles.chip} aria-current={base === '/blog' ? 'page' : undefined}>
                All posts
              </Link>
            </li>
            {taxonomy.categories.map(c => (
              <li key={c.slug}>
                <Link href={`/blog/category/${c.slug}`} className={styles.chip} aria-current={activeCategory === c.slug ? 'page' : undefined}>
                  {c.name} <span className={styles.chipCount}>{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {featured && <PostCard post={featured} featured />}
        {items.length ? (
          <div className={styles.grid}>
            {items.map(p => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        ) : (
          !featured && <p className={styles.empty}>{!list ? 'The blog could not be loaded. Try again in a moment.' : search ? 'Try other words, or browse the categories above.' : 'No posts here yet. Check back soon.'}</p>
        )}
        {list && <Pager base={base} page={page} totalPages={list.meta.totalPages} q={search} />}
      </div>
    </section>
  )
}

/** schema.org BlogPosting, so search engines show the date, author and image. */
export function postJsonLd(post: BlogPost, site: string) {
  const url = `${site}/blog/${post.slug}`
  const image = post.coverImageUrl ? (post.coverImageUrl.startsWith('/') ? `${site}${post.coverImageUrl}` : post.coverImageUrl) : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seoDescription || post.excerpt || undefined,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: post.authorName ? { '@type': 'Person', name: post.authorName } : undefined,
    image,
    mainEntityOfPage: url,
    url,
    keywords: post.tags.map(t => t.name).join(', ') || undefined,
    articleSection: post.category?.name
  }
}

export { scriptJson }

export function BlogPostView({ post, related, site }: { post: BlogPost; related: BlogSummary[]; site: string }) {
  const toc = headingsOf(post.body)

  return (
    <section className={styles.page}>
      <JsonLd
        data={[
          postJsonLd(post, site),
          breadcrumbJsonLd(site, [{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }, ...(post.category ? [{ name: post.category.name, path: `/blog/category/${post.category.slug}` }] : []), { name: post.title, path: `/blog/${post.slug}` }])
        ]}
      />
      <article>
        <div className={styles.narrow}>
          <ol className={styles.crumbs}>
            <li>
              <Link href='/blog'>Blog</Link>
            </li>
            {post.category && (
              <li>
                <Link href={`/blog/category/${post.category.slug}`}>{post.category.name}</Link>
              </li>
            )}
          </ol>
          <header className={styles.postHeader}>
            <h1 className={styles.postTitle}>{post.title}</h1>
            {post.excerpt && <p className={styles.postExcerpt}>{post.excerpt}</p>}
            <Meta post={post} />
          </header>
        </div>
        {post.coverImageUrl && <img src={post.coverImageUrl} alt={post.coverImageAlt} className={styles.postCover} />}
        <div className={`${styles.narrow} ${styles.body} ${styles.bodyWrap}`}>
          {toc.length >= 3 && <PostToc items={toc} />}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHeadingIds]}>
            {post.body}
          </ReactMarkdown>
          {post.tags.length > 0 && (
            <ul className={styles.tags} aria-label='Tags'>
              {post.tags.map(t => (
                <li key={t.slug}>
                  <Link href={`/blog/tag/${t.slug}`} className={styles.chip}>
                    #{t.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ShareBar url={`${site}/blog/${post.slug}`} title={post.title} />
        </div>
      </article>
      {related.length > 0 && (
        <aside className={`${styles.inner} ${styles.related}`} aria-labelledby='related-posts'>
          <h2 id='related-posts' className={styles.relatedTitle}>
            Keep reading
          </h2>
          <div className={styles.grid}>
            {related.map(p => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
        </aside>
      )}
    </section>
  )
}
