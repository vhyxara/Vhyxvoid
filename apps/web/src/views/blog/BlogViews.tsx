// The blog's pages: the list (all posts, a category or a tag) and one post.
// Server components; data comes from publicApi.ts (cached under the "cms" tag,
// refreshed the moment an admin publishes). Post bodies are markdown rendered
// without raw HTML, so a post can't run scripts.
import Link from 'next/link'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { BlogAuthorProfile, BlogList, BlogPost, BlogSummary, BlogTaxonomy } from '@/views/marketing/publicApi'
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

/** An author's links, in a fixed order; handles become profile addresses. */
export function authorLinks(a: Pick<BlogAuthorProfile, 'website' | 'twitter' | 'github' | 'linkedin'>) {
  return [
    a.website && { label: 'Website', href: a.website },
    a.twitter && { label: 'X', href: `https://x.com/${a.twitter}` },
    a.github && { label: 'GitHub', href: `https://github.com/${a.github}` },
    a.linkedin && { label: 'LinkedIn', href: a.linkedin }
  ].filter((l): l is { label: string; href: string } => !!l)
}

function Avatar({ author, size }: { author: { name: string; avatarUrl: string }; size: number }) {
  return author.avatarUrl ? (
    <img src={author.avatarUrl} alt='' className={styles.avatar} style={{ inlineSize: size, blockSize: size }} />
  ) : (
    <span aria-hidden className={styles.avatar} style={{ inlineSize: size, blockSize: size, fontSize: size * 0.42 }}>
      {author.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Meta({ post, linked = false }: { post: Pick<BlogSummary, 'authorName' | 'publishedAt' | 'readingMinutes'> & { author?: BlogSummary['author'] }; linked?: boolean }) {
  const a = post.author

  return (
    <div className={styles.meta}>
      {a ? (
        <span className={styles.metaAuthor}>
          <Avatar author={a} size={22} />
          {linked ? <Link href={`/blog/author/${a.slug}`}>{a.name}</Link> : a.name}
        </span>
      ) : (
        post.authorName && <span>{post.authorName}</span>
      )}
      {(a || post.authorName) && <span aria-hidden>·</span>}
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
  search,
  author
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
  /** An author's page: their photo, title and links in the header. */
  author?: BlogAuthorProfile
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
          {author ? (
            <div className={styles.authorHead}>
              <Avatar author={author} size={88} />
              <div>
                <h1 className={styles.title}>{title}</h1>
                {author.title && <p className={styles.authorTitle}>{author.title}</p>}
                {description && <p className={styles.lead}>{description}</p>}
                <AuthorLinks author={author} />
              </div>
            </div>
          ) : (
            <>
              <h1 className={styles.title}>{title}</h1>
              {description && <p className={styles.lead}>{description}</p>}
            </>
          )}
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
    author: post.author
      ? {
          '@type': 'Person',
          name: post.author.name,
          url: `${site}/blog/author/${post.author.slug}`,
          ...(post.author.avatarUrl ? { image: post.author.avatarUrl.startsWith('/') ? `${site}${post.author.avatarUrl}` : post.author.avatarUrl } : {}),
          ...(post.author.title ? { jobTitle: post.author.title } : {}),
          ...(authorLinks(post.author).length ? { sameAs: authorLinks(post.author).map(l => l.href) } : {})
        }
      : post.authorName
        ? { '@type': 'Person', name: post.authorName }
        : undefined,
    image,
    mainEntityOfPage: url,
    url,
    keywords: post.tags.map(t => t.name).join(', ') || undefined,
    articleSection: post.category?.name
  }
}

function AuthorLinks({ author }: { author: BlogAuthorProfile }) {
  const links = authorLinks(author)

  if (!links.length) return null

  return (
    <ul className={styles.authorLinks} aria-label={`${author.name} elsewhere`}>
      {links.map(l => (
        <li key={l.label}>
          <a href={l.href} target='_blank' rel='noopener noreferrer me'>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

/** Under a post: who wrote it, with a link to their other posts. */
function AuthorCard({ author }: { author: BlogAuthorProfile }) {
  return (
    <aside className={styles.authorCard} aria-label='About the author'>
      <Avatar author={author} size={64} />
      <div>
        <p className={styles.authorName}>
          <Link href={`/blog/author/${author.slug}`}>{author.name}</Link>
          {author.title && <span> · {author.title}</span>}
        </p>
        {author.bio && <p className={styles.authorBio}>{author.bio}</p>}
        <AuthorLinks author={author} />
      </div>
    </aside>
  )
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
            <Meta post={post} linked />
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
          {post.author && <AuthorCard author={post.author} />}
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
