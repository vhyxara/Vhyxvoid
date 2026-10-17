'use client'

// The void behind every marketing page but the landing (which has its own):
// a band of slow stars and nebula at the top of the page, fading into the
// background. Decorative.
import { Starfield } from './Starfield'
import styles from './void.module.css'

export function SiteBackdrop() {
  return (
    <div className={styles.backdrop} aria-hidden>
      <Starfield className={styles.stars} focusX={0.5} focusY={0.05} density={0.5} />
      <div className={styles.backdropNebula} />
    </div>
  )
}
