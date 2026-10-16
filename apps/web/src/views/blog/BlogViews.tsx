// The blog's pages: the list (all posts, a category or a tag) and one post.
// Server components; data comes from publicApi.ts (cached under the "cms" tag,
// refreshed the moment an admin publishes). Post bodies are markdown rendered
// without raw HTML, so a post can't run scripts.
import Link from 'next/link'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { BlogList, BlogPost, BlogSummary, BlogTaxonomy } from '@/views/marketing/publicApi'
import styles from './blog.module.css'

export const formatPostDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** A link to a page of a list, keeping page 1 at the bare address. */
export const pageHref = (base: string, page: number) => (page <= 1 ? base : `${base}?page=${page}`)

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

function Pager({ base, page, totalPages }: { base: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null

  return (
    <nav className={styles.pager} aria-label='Pages'>
      {page > 1 ? (
        <Link href={pageHref(base, page - 1)} rel='prev'>
          ← Newer
        </Link>
      ) : (
        <span aria-disabled>← Newer</span>
      )}
      <span>
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={pageHref(base, page + 1)} rel='next'>
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
  activeCategory
}: {
  list: BlogList | null
  taxonomy: BlogTaxonomy
  /** The list's own address, e.g. /blog or /blog/tag/js. */
  base: string
  title: string
  description?: string
  eyebrow?: { label: string; href: string }
  activeCategory?: string
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
        </header>
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
          !featured && <p className={styles.empty}>{list ? 'No posts here yet. Check back soon.' : 'The blog could not be loaded. Try again in a moment.'}</p>
        )}
        {list && <Pager base={base} page={page} totalPages={list.meta.totalPages} />}
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

/** JSON for a <script> tag: "<" escaped so a title can't close the tag. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export function BlogPostView({ post, related, site }: { post: BlogPost; related: BlogSummary[]; site: string }) {
  return (
    <section className={styles.page}>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: scriptJson(postJsonLd(post, site)) }} />
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
        <div className={`${styles.narrow} ${styles.body}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
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
