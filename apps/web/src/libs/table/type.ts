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

type ConfirmationAction<T> = BaseAction<T> &
  Omit<ConfirmationProps, 'onConfirm'> & {
    type: 'confirmation'
    onConfirm: (row: T) => Promise<void> | void
  }

export type RowAction<T> = ClickAction<T> | DialogAction<T> | ConfirmationAction<T>

export type BulkAction<ID> = {
  key: string
  label: string
  color?: 'error' | 'primary' | 'success' | 'warning' | 'info'
  onClick: (ids: ID[]) => void | Promise<void>
  disabled?: (ids: ID[]) => boolean
}
