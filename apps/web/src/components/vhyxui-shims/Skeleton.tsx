// TEMPORARY SHIM — see README.md in this directory.
// TODO: replace with VhyxUI's own Skeleton component once it ships.
// Tracking: decision.md, 2026-09-10, "Temporary Typography/Skeleton shims".
//
// Deliberately minimal (variant + width/height only) — mirrors the subset
// of MUI Skeleton's API TableSkeleton (src/libs/table/) actually uses.

import type { CSSProperties, HTMLAttributes } from 'react'

import styles from './Skeleton.module.css'

export interface VhyxvoidSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular'
  width?: number | string
  height?: number | string
}

export function Skeleton({ variant = 'text', width, height, className, style, ...rest }: VhyxvoidSkeletonProps) {
  const inlineStyle: CSSProperties = {
    width,
    height: height ?? (variant === 'text' ? '1.2em' : undefined),
    ...style
  }

  const classes = [styles.root, styles[variant], className].filter(Boolean).join(' ')

  return <div className={classes} style={inlineStyle} aria-hidden='true' {...rest} />
}
