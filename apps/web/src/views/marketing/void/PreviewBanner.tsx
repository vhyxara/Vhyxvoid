// The bar above a draft preview: what it is, that visitors can't see it,
// when the link stops working, and the live version if there is one.
import Link from 'next/link'

import styles from './void.module.css'

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

export function PreviewBanner({ what, expiresAt, liveHref, expired }: { what?: string; expiresAt?: string; liveHref?: string; expired?: boolean }) {
  if (expired) {
    return (
      <section className={styles.previewExpired}>
        <h1>This preview link has expired</h1>
        <p>Preview links work for 48 hours, or until the draft is deleted. Ask for a new one from the admin panel (Preview).</p>
        <Link href='/' className={styles.btnGhost}>
          Go to the website
        </Link>
      </section>
    )
  }

  return (
    <div className={styles.previewBar} role='status'>
      <span className={styles.previewDot} aria-hidden />
      <strong>{what ?? 'Draft'} — preview</strong>
      <span>Visitors can&apos;t see this. Link works until {when(expiresAt!)}.</span>
      {liveHref && (
        <Link href={liveHref} className={styles.previewLive}>
          See the live version →
        </Link>
      )}
    </div>
  )
}
