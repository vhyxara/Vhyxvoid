'use client'

// The 404 page: an address that drifted out of the void. The site's shell
// around it (navbar, footer), a wormhole with nothing coming out, and the
// ways back. The status is a real 404 (rendered by notFound()).
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Starfield } from './Starfield'
import styles from './void.module.css'

export function VoidNotFound({ links }: { links: Array<{ label: string; href: string }> }) {
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
          404
        </p>
        <h1 className={styles.lostTitle}>Lost in the void</h1>
        <p className={styles.lead}>
          Nothing answers at <code className={styles.lostPath}>{path || '/'}</code>. It may have moved, or the link has a typo.
        </p>
        <div className={styles.actions} style={{ justifyContent: 'center' }}>
          <Link href='/' className={styles.btnPrimary}>
            Back to home <span aria-hidden>→</span>
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
