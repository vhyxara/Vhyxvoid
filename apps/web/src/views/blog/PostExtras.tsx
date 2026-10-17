'use client'

// The interactive parts of a blog post: the table of contents (it follows
// the reader down the page) and the share bar.
import { useEffect, useState } from 'react'

import type { TocItem } from './toc'
import styles from './blog.module.css'

/** On this page: sticky beside the text on wide screens, a fold-out above it on small ones. */
export function PostToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id)

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const els = items.map(i => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e)
    // The heading nearest the top of the screen, among those above its middle, is the current one.
    const io = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -55% 0px' }
    )

    els.forEach(e => io.observe(e))

    return () => io.disconnect()
  }, [items])

  const list = (
    <ol className={styles.tocList}>
      {items.map(i => (
        <li key={i.id} data-depth={i.depth}>
          <a href={`#${i.id}`} aria-current={i.id === active ? 'location' : undefined} onClick={() => setActive(i.id)}>
            {i.text}
          </a>
        </li>
      ))}
    </ol>
  )

  return (
    <>
      <nav className={styles.tocSide} aria-label='On this page'>
        <div className={styles.tocSticky}>
          <p className={styles.tocTitle}>On this page</p>
          {list}
        </div>
      </nav>
      <details className={styles.tocFold}>
        <summary>On this page</summary>
        {list}
      </details>
    </>
  )
}

export function shareLinks(url: string, title: string) {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(title)

  return [
    { label: 'X', href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { label: 'Reddit', href: `https://www.reddit.com/submit?url=${u}&title=${t}` },
    { label: 'Hacker News', href: `https://news.ycombinator.com/submitlink?u=${u}&t=${t}` },
    { label: 'Email', href: `mailto:?subject=${t}&body=${u}` }
  ]
}

export function ShareBar({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const [native, setNative] = useState(false)

  useEffect(() => setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), [])

  return (
    <div className={styles.share} role='group' aria-label='Share this post'>
      <span className={styles.shareLabel}>Share</span>
      {native && (
        <button type='button' className={styles.chip} onClick={() => navigator.share({ title, url }).catch(() => {})}>
          Share…
        </button>
      )}
      {shareLinks(url, title).map(s => (
        <a key={s.label} href={s.href} className={styles.chip} target={s.label === 'Email' ? undefined : '_blank'} rel='noopener noreferrer'>
          {s.label}
        </a>
      ))}
      <button
        type='button'
        className={styles.chip}
        onClick={() =>
          navigator.clipboard
            ?.writeText(url)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1800)
            })
            .catch(() => {})
        }
      >
        {copied ? '✓ Link copied' : 'Copy link'}
      </button>
    </div>
  )
}
