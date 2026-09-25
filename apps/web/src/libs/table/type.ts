import type { ComponentType, ReactNode } from 'react'

import type { ConfirmationProps } from '../components/Confirmation'

type BaseAction<T> = {
  key: string
  icon: ReactNode
  color?: 'error' | 'primary' | 'secondary' | 'info' | 'success' | 'warning'
  disabled?: (row: T) => boolean
}

type ClickAction<T> = BaseAction<T> & {
  type: 'click'
  label?: string
  onClick: (row: T) => void | Promise<void>
}

type DialogAction<T> = BaseAction<T> & {
  type: 'dialog'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dialogComponent: ComponentType<any> // ← was ComponentType<{open, onClose, row} & Record<string,never>>
  dialogProps?: Record<string, unknown> // ← was Record<string, never>
}

// 'disabled' is excluded from ConfirmationProps here: BaseAction<T>'s
// `(row: T) => boolean` is what action authors write; RowAction.tsx evaluates
// it and passes the boolean to Confirmation's own `disabled` prop (same as
// apps/admin's copy of this file).
type ConfirmationAction<T> = BaseAction<T> &
  Omit<ConfirmationProps, 'onConfirm' | 'disabled'> & {
    type: 'confirmation'
    // Promise<unknown>, not Promise<void> — real callers return a real
    // mutateAsync() promise (see decision.md, 2026-09-19, "FeedbackContext
    // removed"), which resolves to the mutation's own real value, not
    // undefined. Confirmation.tsx only awaits this to know when the
    // request finished / whether it rejected, never reads the value.
    onConfirm: (row: T) => Promise<unknown> | void
  }

export type RowAction<T> = ClickAction<T> | DialogAction<T> | ConfirmationAction<T>

export type BulkAction<ID> = {
  key: string
  label: string
  color?: 'error' | 'primary' | 'success' | 'warning' | 'info'
  onClick: (ids: ID[]) => void | Promise<void>
  disabled?: (ids: ID[]) => boolean
}
