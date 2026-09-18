import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import Confirmation from './Confirmation'

// Same stubbing rationale as GenericServerTable.test.tsx — @vhyxui/react's
// components throw "Invalid hook call" under this repo's own React instance
// (cross-repo `link:` React duplication). Dialog.Portal is gated on the
// real component's own `open` state via a context the mocked Dialog
// provides, matching the real component's documented behavior ("Dialog.
// Content on its own is NOT gated on open state — only Dialog.Portal is",
// Confirmation.tsx's own comment) — otherwise the dialog's own confirm
// button (same accessible text as the trigger) would always be in the DOM
// and every query below would be ambiguous.
vi.mock('@vhyxui/react', async () => {
  const DialogOpenContext = createContext(false)

  const Dialog = Object.assign(
    ({ open, children }: { open?: boolean; children?: ReactNode }) => (
      <DialogOpenContext.Provider value={!!open}>{children}</DialogOpenContext.Provider>
    ),
    {
      Portal: ({ children }: { children?: ReactNode }) => (useContext(DialogOpenContext) ? <div>{children}</div> : null),
      Overlay: () => null,
      Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Title: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Description: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Footer: ({ children }: { children?: ReactNode }) => <div>{children}</div>
    }
  )

  return {
    Button: ({ children, loading, ...props }: ComponentProps<'button'> & { loading?: boolean }) => (
      <button {...props} data-loading={loading ? 'true' : 'false'}>
        {children}
      </button>
    ),
    Dialog
  }
})

/**
 * Regression tests for the 2026-09-19 fix: Confirmation.tsx's own error-
 * catching path (and the loading state) only worked correctly when
 * `onConfirm` returned the real mutation's own promise (`.mutateAsync()`)
 * rather than firing a mutation and returning immediately (`.mutate()`).
 * Before the fix, every real caller in the app used the latter, which made
 * both the loading state and error handling dishonest: the dialog closed
 * and the loading spinner disappeared the instant `onConfirm` was *called*,
 * not when the real request actually finished. See decision.md, 2026-09-19,
 * "FeedbackContext removed".
 */

// The trigger button (icon-only, aria-label={confirmButtonText}) and the
// real Dialog's own confirm button share the same accessible name by
// default (both derive from confirmButtonText) — real, pre-existing
// behavior, not something this fix changed. `getByRole` alone is ambiguous
// once the dialog is open; these helpers disambiguate by DOM order (the
// trigger always renders first, the Dialog's confirm button second).
function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Proceed' }))
}

function clickConfirm() {
  const buttons = screen.getAllByRole('button', { name: 'Yes, Proceed' })

  fireEvent.click(buttons[buttons.length - 1])
}

describe('Confirmation — awaits the real onConfirm promise, not a fire-and-forget call', () => {
  it('shows the loading state for the real duration of an async onConfirm, not just an instant flash', async () => {
    let resolvePromise: () => void = () => {}
    const pending = new Promise<void>(resolve => {
      resolvePromise = resolve
    })

    render(<Confirmation onConfirm={() => pending} loadingText='Processing...' />)
    openDialog()

    clickConfirm()

    // While onConfirm's real promise is still pending, the button must
    // still show the loading state -- this is the exact thing that was
    // dishonest before the fix (fire-and-forget .mutate() meant this state
    // was true for one microtask at most, regardless of how long the real
    // request actually took).
    await waitFor(() => {
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    resolvePromise()

    await waitFor(() => {
      expect(screen.queryByText('Processing...')).not.toBeInTheDocument()
    })
  })

  it('calls onSuccessCallback only after the real onConfirm promise resolves, not immediately', async () => {
    let resolvePromise: () => void = () => {}
    const pending = new Promise<void>(resolve => {
      resolvePromise = resolve
    })
    const onSuccessCallback = vi.fn()

    render(<Confirmation onConfirm={() => pending} onSuccessCallback={onSuccessCallback} />)
    openDialog()

    clickConfirm()

    // Still pending -- must not have fired yet.
    expect(onSuccessCallback).not.toHaveBeenCalled()

    resolvePromise()

    await waitFor(() => {
      expect(onSuccessCallback).toHaveBeenCalledTimes(1)
    })
  })

  it('does not throw, still closes the dialog, and clears the loading state when the real onConfirm promise rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'))
    const onSuccessCallback = vi.fn()

    render(<Confirmation onConfirm={onConfirm} onSuccessCallback={onSuccessCallback} />)
    openDialog()

    // Real content is on screen (dialog genuinely open) before confirming.
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()

    clickConfirm()

    // The rejection must not escape as an unhandled promise rejection or a
    // thrown error (which would fail this test) -- Confirmation.tsx's own
    // catch block, not the global QueryClient error handler, is what
    // prevents that here.
    await waitFor(() => {
      expect(screen.queryByText('This action cannot be undone.')).not.toBeInTheDocument()
    })

    expect(onSuccessCallback).not.toHaveBeenCalled()
  })

  it('an onConfirm that returns void (not a promise) still completes the confirm/close flow', async () => {
    const onConfirm = vi.fn()

    render(<Confirmation onConfirm={onConfirm} />)
    openDialog()

    clickConfirm()

    expect(onConfirm).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.queryByText('This action cannot be undone.')).not.toBeInTheDocument()
    })
  })
})
