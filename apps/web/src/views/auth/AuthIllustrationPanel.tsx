'use client'

import type { CSSProperties } from 'react'

import classnames from 'classnames'

import { AuthMaskImage } from './AuthMaskImage'
import styles from './AuthIllustrationPanel.module.css'

type Props = {
  characterSrc: string
  characterAlt: string
  maskSrc: string
  bordered?: boolean
  characterMaxHeight?: number
  maskMaxHeight?: number
}

// Left-panel illustration wrapper shared by Login/Register/
// ForgotPasswordView/ResetPasswordView — replaces the byte-identical block
// each of those four pages duplicated on its own MUI styled()/useTheme()
// illustration. Confirmed structurally identical by direct diff-reading
// before extracting this, not assumed from file names — the only real
// differences were `characterMaxHeight`/`maskMaxHeight` (Register uses
// 600/345, the others 680/355) and the page-specific image srcs/alt text,
// both already parameterized here. See decision.md, 2026-09-16,
// "Phase 4 part 1" for the full design.
export function AuthIllustrationPanel({
  characterSrc,
  characterAlt,
  maskSrc,
  bordered,
  characterMaxHeight = 680,
  maskMaxHeight = 355
}: Props) {
  return (
    <div
      className={classnames('flex bs-full items-center justify-center flex-1 min-bs-dvh relative p-6 max-md:hidden', {
        'border-ie': bordered
      })}
    >
      <img
        src={characterSrc}
        alt={characterAlt}
        className={classnames(styles.character, 'z-[2] bs-auto max-is-full m-12')}
        style={{ '--character-max-h': `${characterMaxHeight}px` } as CSSProperties}
      />
      <AuthMaskImage src={maskSrc} maxHeight={maskMaxHeight} />
    </div>
  )
}
