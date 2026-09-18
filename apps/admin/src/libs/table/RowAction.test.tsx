import type { ComponentProps, ReactNode } from 'react'

import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { RowActions } from './RowAction'
import type { RowAction } from './type'

// Same stubbing rationale as GenericServerTable.test.tsx — @vhyxui/react's
// components throw "Invalid hook call" under this repo's React instance
// (cross-repo `link:` React duplication), and nothing here depends on their
// actual rendering. Button passes `disabled` through to a real DOM button
// so a real regression guard can assert on it directly. Dialog.Portal is
// gated on the real component's own `open` state (via a context the mocked
// Dialog provides) — matching the real component's documented behavior
// ("Dialog.Content on its own is NOT gated on open state — only
// Dialog.Portal is", Confirmation.tsx's own comment) — otherwise the
// dialog's own confirm button (same accessible text as the trigger) would
// always be in the DOM and every query below would be ambiguous.
vi.mock('@vhyxui/react', async () => {
  const { createContext, useContext } = await import('react')
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
    Button: ({ children, ...props }: ComponentProps<'button'>) => <button {...props}>{children}</button>,
    Dialog
  }
})

vi.mock('../../contexts/FeedbackContext', () => ({
  useFeedback: () => ({ showFeedback: vi.fn() })
}))

type Row = { id: string; isSuperAdmin: boolean }

const ROW_REGULAR: Row = { id: '1', isSuperAdmin: false }
const ROW_SUPER: Row = { id: '2', isSuperAdmin: true }

/**
 * Regression test for the 2026-09-18 chrome-visual bug: a `confirmation`-
 * type RowAction's `disabled` callback was computed correctly by every
 * caller (e.g. AdminUsersTable's `disabled: () => admin.isSuperAdmin ||
 * isSelf`) but RowAction.tsx never forwarded it to <Confirmation>, and
 * Confirmation.tsx had no `disabled` prop to receive it even if it had —
 * so the guard was silently a no-op. See decision.md, 2026-09-18.
 */
function confirmationAction(disabled: (row: Row) => boolean): RowAction<Row> {
  return {
    key: 'disable',
    type: 'confirmation',
    icon: 'tabler-ban',
    color: 'error',
    title: 'Disable admin',
    content: 'Disable this admin?',
    confirmButtonText: 'Disable this row',
    disabled,
    onConfirm: vi.fn()
  }
}

describe('RowActions — confirmation-type disabled guard', () => {
  it('disables the trigger button when the action.disabled callback returns true for the row', () => {
    render(<RowActions row={ROW_SUPER} actions={[confirmationAction(row => row.isSuperAdmin)]} />)

    const trigger = screen.getByRole('button', { name: 'Disable this row' })

    expect(trigger).toBeDisabled()
  })

  it('leaves the trigger button enabled when the action.disabled callback returns false for the row', () => {
    render(<RowActions row={ROW_REGULAR} actions={[confirmationAction(row => row.isSuperAdmin)]} />)

    const trigger = screen.getByRole('button', { name: 'Disable this row' })

    expect(trigger).not.toBeDisabled()
  })

  it('a disabled trigger cannot open the confirmation dialog even if clicked', () => {
    render(<RowActions row={ROW_SUPER} actions={[confirmationAction(row => row.isSuperAdmin)]} />)

    const trigger = screen.getByRole('button', { name: 'Disable this row' })

    fireEvent.click(trigger)

    expect(screen.queryByText('Disable admin')).not.toBeInTheDocument()
  })

  it('an enabled trigger opens the confirmation dialog when clicked', () => {
    render(<RowActions row={ROW_REGULAR} actions={[confirmationAction(row => row.isSuperAdmin)]} />)

    const trigger = screen.getByRole('button', { name: 'Disable this row' })

    fireEvent.click(trigger)

    expect(screen.getByText('Disable admin')).toBeInTheDocument()
  })

  it('an action with no disabled callback leaves the trigger enabled (undefined, not a crash)', () => {
    render(
      <RowActions
        row={ROW_REGULAR}
        actions={[
          {
            key: 'view',
            type: 'click',
            icon: 'tabler-eye',
            onClick: vi.fn()
          }
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'view' })).not.toBeDisabled()
  })
})
