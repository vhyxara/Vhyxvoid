'use client'

// The 404 page (and, with other words, the error page): an address that drifted out of the void. The site's shell
// around it (navbar, footer), a wormhole with nothing coming out, and the
// ways back. The status is a real 404 (rendered by notFound()).
import type { ReactNode } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Starfield } from './Starfield'
import styles from './void.module.css'

type Props = {
  links: Array<{ label: string; href: string }>
  /** Defaults are the 404's; the error page passes its own. */
  code?: string
  title?: string
  message?: ReactNode
  onRetry?: () => void
}

export function VoidNotFound({ links, code = '404', title = 'Lost in the void', message, onRetry }: Props) {
  const path = usePathname()

  return (
    <section className={styles.lost}>
      <Starfield className={styles.stars} focusX={0.5} focusY={0.36} density={0.7} />
      <div className={styles.lostInner}>
        <div className={styles.lostPortal} aria-hidden>
          {[0, 1, 2].map(i => (
            <span key={i} className={styles.lostRing} style={{ animationDelay: `${i * -2}s` }} />
          ))}
          <span className={styles.lostCore} />
        </div>
        <p className={styles.lostCode} aria-hidden>
          {code}
        </p>
        <h1 className={styles.lostTitle}>{title}</h1>
        <p className={styles.lead}>
          {message ?? (
            <>
              Nothing answers at <code className={styles.lostPath}>{path || '/'}</code>. It may have moved, or the link has a typo.
            </>
          )}
        </p>
        <div className={styles.actions} style={{ justifyContent: 'center' }}>
          {onRetry && (
            <button type='button' onClick={onRetry} className={styles.btnPrimary} style={{ border: 0, cursor: 'pointer', font: 'inherit' }}>
              Try again <span aria-hidden>↻</span>
            </button>
          )}
          <Link href='/' className={onRetry ? styles.btnGhost : styles.btnPrimary}>
            Back to home {!onRetry && <span aria-hidden>→</span>}
          </Link>
          {links.map(l => (
            <Link key={l.href} href={l.href} className={styles.btnGhost}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
