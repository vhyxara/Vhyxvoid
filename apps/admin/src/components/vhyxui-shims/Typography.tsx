// TEMPORARY SHIM — see README.md in this directory.
// TODO: replace with VhyxUI's own Typography component once it ships.
// Tracking: decision.md, 2026-09-10, "Temporary Typography/Skeleton shims".
//
// Mirrors the small slice of MUI Typography's API this app actually uses
// (variant + optional tag override), not MUI's full surface — don't extend
// this without checking the tracking decision first.

import type { ElementType, HTMLAttributes } from 'react'
import { forwardRef } from 'react'

import styles from './Typography.module.css'

export type VhyxvoidTypographyVariant =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'subtitle1' | 'subtitle2'
  | 'body1' | 'body2'
  | 'caption' | 'overline' | 'button'

// Same default tag-per-variant mapping MUI's own Typography uses.
const defaultTagByVariant: Record<VhyxvoidTypographyVariant, ElementType> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  subtitle1: 'h6', subtitle2: 'h6',
  body1: 'p', body2: 'p',
  caption: 'span', overline: 'span', button: 'span'
}

export interface VhyxvoidTypographyProps extends HTMLAttributes<HTMLElement> {
  variant?: VhyxvoidTypographyVariant
  /** Override the rendered tag, same idea as MUI's `component` prop. */
  component?: ElementType
}

export const Typography = forwardRef<HTMLElement, VhyxvoidTypographyProps>(
  ({ variant = 'body1', component, className, children, ...rest }, ref) => {
    const Tag = component ?? defaultTagByVariant[variant]
    const classes = [styles.root, styles[variant], className].filter(Boolean).join(' ')

    return (
      <Tag ref={ref} className={classes} {...rest}>
        {children}
      </Tag>
    )
  }
)

Typography.displayName = 'VhyxvoidTypographyShim'
