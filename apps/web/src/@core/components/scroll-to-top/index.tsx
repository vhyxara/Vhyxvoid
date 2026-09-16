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
// wrapper, both trivial to hand-roll. Position/threshold values (400px
// threshold, 160px/112px inset) are unchanged from the original's
// theme.spacing(20)/theme.spacing(14) (MUI's default spacing unit is 8px).
// See decision.md, 2026-09-16, "Phase 3 part 2".
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
        insetInlineEnd: 160,
        insetBlockEnd: 112,
        zIndex: 1050
      }}
    >
      {children}
    </div>
  )
}

export default ScrollToTop
