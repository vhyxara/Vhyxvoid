import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import ScrollToTop from './index'

/**
 * Regression test for the 2026-09-18 chrome-visual.md finding: ScrollToTop's
 * fixed position (160px/112px inset, unchanged from the original MUI
 * theme.spacing(20)/theme.spacing(14) values) sat far enough inward from the
 * true viewport corner that it visually overlapped a paginated table's own
 * page-number control on pages where that table's pagination row reached
 * similarly far right at the bottom of the viewport (reproduced on Tunnels'
 * Session history table). Fixed by hugging the true corner instead (24px),
 * stacked above FeedbackButton.tsx's FAB (bottom:50, right:24, 48px tall) --
 * see decision.md, 2026-09-19, "ScrollToTop repositioned". This test locks in
 * the new inset values so a future change can't silently reintroduce the old
 * ones (or a value that collides with FeedbackButton's FAB) without a test
 * failure calling it out.
 */
describe('ScrollToTop positioning', () => {
  afterEach(() => {
    window.scrollY = 0
  })

  function setScrollY(value: number) {
    Object.defineProperty(window, 'scrollY', { value, writable: true, configurable: true })
    fireEvent.scroll(window)
  }

  it('renders at a fixed inset that hugs the true viewport corner (24px), not the old 160px/112px inset that collided with table pagination', async () => {
    render(
      <ScrollToTop>
        <button>scroll to top</button>
      </ScrollToTop>
    )

    setScrollY(500)

    const wrapper = await waitFor(() => screen.getByRole('presentation'))

    expect(wrapper.style.insetInlineEnd).toBe('24px')
    expect(wrapper.style.insetBlockEnd).toBe('114px')

    // The old, colliding values must not reappear.
    expect(wrapper.style.insetInlineEnd).not.toBe('160px')
    expect(wrapper.style.insetBlockEnd).not.toBe('112px')
  })

  it('stays clear of FeedbackButton\'s own fixed FAB (bottom:50, right:24, 48px tall) -- no vertical overlap between the two fixed corner controls', async () => {
    render(
      <ScrollToTop>
        <button>scroll to top</button>
      </ScrollToTop>
    )

    setScrollY(500)

    const wrapper = await waitFor(() => screen.getByRole('presentation'))
    const scrollToTopBottomInset = Number(wrapper.style.insetBlockEnd.replace('px', ''))

    const feedbackFabTop = 50 + 48 // FeedbackButton's bottom inset + its own height
    const feedbackFabGap = feedbackFabTop + 16 // matches the 16px stacking gap decided in decision.md

    expect(scrollToTopBottomInset).toBeGreaterThanOrEqual(feedbackFabGap)
  })

  it('is not rendered before the 400px scroll threshold, and disappears again below it', async () => {
    render(
      <ScrollToTop>
        <button>scroll to top</button>
      </ScrollToTop>
    )

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()

    setScrollY(500)
    await waitFor(() => expect(screen.getByRole('presentation')).toBeInTheDocument())

    setScrollY(0)
    await waitFor(() => expect(screen.queryByRole('presentation')).not.toBeInTheDocument())
  })
})
