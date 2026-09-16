'use client'

import Link from 'next/link'

import useVerticalNav from '@menu/hooks/useVerticalNav'

import styles from './DashboardFooter.module.css'

// Ported 1:1 from libs/layout/vertical/FooterContent.tsx — trivial, no
// behavior beyond hiding the doc/support links below the mobile breakpoint.
export function DashboardFooter() {
  const { isBreakpointReached } = useVerticalNav()

  return (
    <footer className={styles.footer}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>© {new Date().getFullYear()}</span>
        <span className={styles.brand}>
          <span style={{ color: 'var(--vhyx-color-text)' }}>Vhyx</span>
          <span style={{ color: 'var(--vhyx-color-accent)' }}>Void</span>
        </span>
        <span>. Secure tunnels for your local world.</span>
      </p>

      {!isBreakpointReached && (
        <div className={styles.links}>
          <Link href='/docs' target='_blank'>
            Documentation
          </Link>
          <Link href='/support' target='_blank'>
            Support
          </Link>
        </div>
      )}
    </footer>
  )
}
