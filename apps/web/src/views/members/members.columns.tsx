import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'

import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { roleLevelName, roleLevelColor, RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { type Member } from '@/api/domain/identity/types/member.types'
import { ChangeRoleDialog } from './ChangeRoleDialog'
import { TransferOwnershipDialog } from './TransferOwnershipDialog'
import type { Permissions } from '@/api/application/hooks/usePermissions'

const col = createColumnHelper<Member>()

type BuildColumnsArgs = {
  accountId: string
  permissions: Permissions

  onRemove: (userId: string) => void
}

export function buildMemberColumns({ accountId, permissions, onRemove }: BuildColumnsArgs): ColumnDef<Member, any>[] {
  const { canManageRow, isOwner } = permissions

  return [
    // ── Select ───────────────────────────────────────────────────────────
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
    },

    // ── User ID (replace with name/email once your user endpoint exposes it) ──
    col.accessor('userId', {
      header: 'User',
      cell: info => (
        <Typography variant='body2' fontFamily='monospace' fontSize={12}>
          {info.getValue()}
        </Typography>
      )
    }),

    // ── Role ─────────────────────────────────────────────────────────────
    col.accessor('role', {
      header: 'Role',
      cell: info => (
        <Chip
          label={roleLevelName(info.getValue())}
          color={roleLevelColor(info.getValue())}
          size='small'
          variant='tonal'
        />
      )
    }),

    // ── Joined ───────────────────────────────────────────────────────────
    col.accessor('joinedAt', {
      header: 'Joined',
      cell: info => (
        <Typography variant='body2' color='text.secondary'>
          {new Date(info.getValue()).toLocaleDateString()}
        </Typography>
      )
    }),

    // ── Actions ──────────────────────────────────────────────────────────
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const member = row.original
        const isManageable = canManageRow(member)

        const actions: RowAction<Member>[] = [
          // Change role — admin+ only, cannot touch equal/higher
          {
            key: 'change-role',
            type: 'dialog',
            icon: 'tabler-shield-check',
            color: 'primary',
            disabled: () => !isManageable,
            dialogComponent: ChangeRoleDialog,
            dialogProps: { accountId, row: member }
          },

          // Transfer ownership — owner only, only appears on non-owner rows
          ...(isOwner && member.role.level !== RoleLevel.OWNER
            ? [
                {
                  key: 'transfer-ownership',
                  type: 'dialog' as const,
                  icon: 'tabler-crown',
                  color: 'warning' as const,
                  dialogComponent: TransferOwnershipDialog as any,
                  dialogProps: { accountId }
                }
              ]
            : []),

          // Remove — admin+ only, cannot touch equal/higher
          {
            key: 'remove',
            type: 'confirmation',
            icon: 'tabler-trash',
            color: 'error',
            title: 'Remove member',
            content: `Remove this member from the organization? This cannot be undone.`,
            confirmButtonText: 'Remove',
            confirmButtonColor: 'error',
            disabled: () => !isManageable,

            onConfirm: () => onRemove(member.userId)
          }
        ]

        return <RowActions row={member} actions={actions} />
      }
    }
  ]
}
