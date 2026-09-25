import type { ReactNode } from 'react'

import { Button } from '@vhyxui/react'

import type { RowAction } from './type'

import Confirmation from '@/libs/components/Confirmation'
import OpenDialogOnElementClick from '../dialogs/OpenDialogOnElementClick'

// RowAction's BaseAction.color is a plain semantic-color name, independent of
// MUI. VhyxUI's Button has no per-instance color prop (only a fixed variant
// set), so instead of losing the semantic tint entirely, apply it directly
// to the icon's color — matching MUI IconButton's own actual visual effect
// (it tints the icon, it doesn't fill the button background either).
const COLOR_VAR: Record<string, string> = {
  error: 'var(--vhyx-color-danger)',
  warning: 'var(--vhyx-color-warning)',
  success: 'var(--vhyx-color-success)',
  info: 'var(--vhyx-color-info)',
  primary: 'var(--vhyx-color-accent)'
}

function tintedIcon(icon: ReactNode, color: string | undefined) {
  const colorVar = color ? COLOR_VAR[color] : undefined

  if (!colorVar || typeof icon !== 'object' || icon === null) return icon

  return <span style={{ color: colorVar, display: 'inline-flex' }}>{icon}</span>
}

export function RowActions<T extends { id: string | number }>({ row, actions }: { row: T; actions: RowAction<T>[] }) {
  return (
    <div className='flex gap-2'>
      {actions.map(action => {
        if (action.type === 'click') {
          return (
            <Button
              key={action.key}
              variant='ghost'
              size='sm'
              iconOnly
              aria-label={action.key}
              icon={tintedIcon(action.icon, action.color) as any}
              disabled={action.disabled?.(row)}
              onClick={() => action.onClick(row)}
            />
          )
        }

        if (action.type === 'dialog') {
          return (
            <OpenDialogOnElementClick
              key={action.key}
              element={Button}
              elementProps={{
                variant: 'ghost',
                size: 'sm',
                iconOnly: true,
                'aria-label': action.key,
                icon: tintedIcon(action.icon, action.color),
                disabled: action.disabled?.(row)
              }}
              dialog={action.dialogComponent}
              dialogProps={{ row, ...(action.dialogProps || {}) }}
            />
          )
        }

        if (action.type === 'confirmation') {
          return (
            <Confirmation
              key={action.key}
              title={action.title}
              content={action.content}
              confirmButtonText={action.confirmButtonText || 'Delete'}
              confirmButtonColor={action.confirmButtonColor || 'error'}
              icon={typeof action.icon === 'string' ? action.icon : undefined}
              disabled={action.disabled?.(row)}
              onConfirm={() => action.onConfirm?.(row)} // call mutation here
            />
          )
        }

        return null
      })}
    </div>
  )
}
