'use client'

import { useBreakpointDown } from '@core/hooks/useBreakpointDown'

type Props = {
  src: string
  maxHeight?: number
}

// Mask image behind the character illustration (Login/Register/
// ForgotPasswordView/ResetPasswordView) or page content (NotFound). Hidden
// below md (900px) — not just visually: the element is unmounted entirely
// so the browser never fetches `src` on small viewports, matching the
// original MUI useMediaQuery-gated `{!hidden && <MaskImg .../>}` behavior
// (a plain CSS `hidden` class wouldn't stop the image fetch). `rtl:
// scale-x-[-1]` replaces `theme.direction === 'rtl'` — Tailwind's built-in
// rtl: variant reacts to the real <html dir> attribute directly, no JS
// needed (RTL is confirmed fully dead code today — see decision.md — kept
// structurally correct anyway since it's free to preserve). See
// decision.md, 2026-09-16, "Phase 4 part 1".
export function AuthMaskImage({ src, maxHeight = 355 }: Props) {
  const hidden = useBreakpointDown(900)

  if (hidden) return null

  return (
    <img
      alt='mask'
      src={src}
      className='bs-auto is-full absolute block-end-0 z-[-1] rtl:scale-x-[-1]'
      style={{ maxBlockSize: maxHeight }}
    />
  )
}
