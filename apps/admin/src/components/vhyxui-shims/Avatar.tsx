// TEMPORARY SHIM — see README.md in this directory.
// TODO: replace with VhyxUI's own Avatar component once it ships (confirmed
// MISSING in the migration gap-analysis report). Tracking: decision.md,
// 2026-09-10, "Temporary Typography/Skeleton shims" — same pattern, same
// rules apply (this entry predates Avatar but the rules generalize).

import type { HTMLAttributes } from 'react'

import styles from './Avatar.module.css'

export interface VhyxvoidAvatarProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg'
  src?: string
  alt?: string
  /** Fallback content when no `src` — typically initials. */
  children?: React.ReactNode
}

export function Avatar({ size = 'md', src, alt, children, className, ...rest }: VhyxvoidAvatarProps) {
  const classes = [styles.root, styles[size], className].filter(Boolean).join(' ')

  return (
    <div className={classes} {...rest}>
      {src ? <img className={styles.image} src={src} alt={alt ?? ''} /> : children}
    </div>
  )
}
