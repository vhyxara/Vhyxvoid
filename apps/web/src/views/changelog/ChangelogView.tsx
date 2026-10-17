// /changelog: release notes, newest first, as a timeline. Each entry has an
// anchor (#v1-8-0, or its date) so a release can be linked to.
import Link from 'next/link'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ChangelogEntry, ChangelogKind, ChangelogList } from '@/views/marketing/publicApi'
import { makeSlugger } from '@/views/blog/toc'
import blog from '@/views/blog/blog.module.css'
import styles from './changelog.module.css'

export const KIND_LABEL: Record<ChangelogKind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed', security: 'Security' }

/** Anchors for a page of entries: "v1-8-0" from the version, else the date; repeats get -1, -2… */
export function changelogAnchors(entries: Pick<ChangelogEntry, 'version' | 'publishedAt'>[]) {
  const slug = makeSlugger()

  return entries.map(e => slug(e.version ? `v${e.version.replace(/^v/i, '').replace(/\./g, '-')}` : e.publishedAt.slice(0, 10)))
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

export function ChangelogView({ list, page, newsletter = true }: { list: ChangelogList | null; page: number; newsletter?: boolean }) {
  const items = list?.items ?? []
  const anchors = changelogAnchors(items)

  return (
    <div className={blog.page}>
      <div className={styles.inner}>
        <header className={blog.header}>
          <span className={blog.eyebrow}>Changelog</span>
          <h1 className={blog.title}>What’s new</h1>
          <p className={blog.lead}>Every release: new features, improvements and fixes.</p>
          <p className={styles.follow}>
            <a href='/changelog/rss.xml'>RSS feed</a>
            {newsletter && (
              <>
                <span aria-hidden>·</span>
                <a href='#newsletter-title'>Get updates by email</a>
              </>
            )}
          </p>
        </header>

        {items.length === 0 ? (
          <p className={blog.empty}>Nothing here yet. The first release notes are on their way.</p>
        ) : (
          <ol className={styles.timeline}>
            {items.map((e, i) => (
              <li key={e.id} id={anchors[i]} className={styles.entry}>
                <div className={styles.when}>
                  <time dateTime={e.publishedAt}>{day(e.publishedAt)}</time>
                  {e.version && <span className={styles.version}>v{e.version.replace(/^v/i, '')}</span>}
                </div>
                <article className={styles.card}>
                  {e.kinds.length > 0 && (
                    <ul className={styles.kinds} aria-label='Kind of change'>
                      {e.kinds.map(k => (
                        <li key={k} data-kind={k}>
                          {KIND_LABEL[k]}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h2 className={styles.entryTitle}>
                    <a href={`#${anchors[i]}`}>{e.title}</a>
                  </h2>
                  {e.body && (
                    <div className={`${blog.body} ${styles.body}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.body}</ReactMarkdown>
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}

        {list && list.pages > 1 && (
          <nav className={blog.pager} aria-label='Pages'>
            {page > 1 ? (
              <Link href={page === 2 ? '/changelog' : `/changelog?page=${page - 1}`} rel='prev'>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {page} of {list.pages}
            </span>
            {page < list.pages ? (
              <Link href={`/changelog?page=${page + 1}`} rel='next'>
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
