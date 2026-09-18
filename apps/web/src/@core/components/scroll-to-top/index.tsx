'use client'

// React Imports
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

interface ScrollToTopProps {
  className?: string
  children: ReactNode
}

// Migrated off MUI's Zoom + useScrollTrigger + styled('div') — a plain
// scroll-position state + conditional render replaces all three. No
// VhyxUI equivalent needed: this was never using any MUI *component*
// styling, just a scroll-threshold visibility trigger and a fixed-position
// wrapper, both trivial to hand-roll. See decision.md, 2026-09-16, "Phase 3
// part 2" for that migration, and decision.md, 2026-09-19, "ScrollToTop
// repositioned" for why the inset below no longer matches that entry's
// original 160px/112px values.
//
// The original 160px/112px inset (carried over unchanged from MUI's
// theme.spacing(20)/theme.spacing(14)) pulled the button inward from the
// true viewport corner, far enough that it landed on top of any
// bottom-right-aligned in-flow content reaching that same screen region —
// concretely, a paginated table's own page-number control (found
// 2026-09-18, chrome-visual.md full pass; reproduced on Tunnels' Session
// history table). Repositioned to hug the actual viewport corner instead
// (24px), stacked directly above FeedbackButton.tsx's FAB (bottom:50,
// right:24, 48px tall) with a 16px gap — the exact inset FeedbackButton's
// own FAB already uses, already confirmed collision-free with in-flow
// content on every page checked in that same verification pass. In-flow
// page content has its own margin from the true viewport edge (the
// dashboard shell's own padding), so hugging the corner — rather than
// sitting partway into that margin — is what actually avoids the
// collision on any page, not just Tunnels specifically.
const ScrollToTop = ({ children, className }: ScrollToTopProps) => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > 400)

    handleScroll()
    window.addEventListener('scroll', handleScroll)

    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const handleClick = () => {
    document.querySelector('body')?.scrollIntoView({ behavior: 'smooth' })
  }

  if (!visible) return null

  return (
    <div
      className={className}
      onClick={handleClick}
      role='presentation'
      style={{
        position: 'fixed',
        insetInlineEnd: 24,
        insetBlockEnd: 114,
        zIndex: 1050
      }}
    >
      {children}
    </div>
  )
}

export default ScrollToTop
