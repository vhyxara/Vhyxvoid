'use client'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { Badge } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { RoleLevel, roleLevelColor, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import { useCancelInvitation, useInvitationsTableList } from '@/api/application/hooks/useOrg'
import { usePermissions } from '@/api/application/hooks/usePermissions'
import type { Invitation } from '@/api/domain/identity/types/member.types'

// roleLevelColor() returns MUI-style names ('error' | 'warning' | 'default').
// VhyxUI's Badge has no 'error' variant (only default/success/warning/danger/
// info/outline) — same mapping used in MembersTable/ApiKeysView/TunnelsView.
function roleBadgeVariant(level: RoleLevel) {
  const c = roleLevelColor(level)

  if (c === 'error') return 'danger' as const
  if (c === 'warning') return 'warning' as const

  return 'default' as const
}

const col = createColumnHelper<Invitation>()

function buildColumns(args: {
  accountId: string
  onCancel: (id: string) => void
  isAdmin: boolean
}): ColumnDef<Invitation, any>[] {
  return [
    col.accessor('email', {
      header: 'Invited email',
      enableSorting: true,
      cell: info => <Typography variant='body2'>{info.getValue()}</Typography>
    }),

    col.accessor('roleLevel', {
      header: 'Role',
      enableSorting: true,
      cell: info => (
        <Badge variant={roleBadgeVariant(info.getValue())} size='sm'>
          {roleLevelName(info.getValue())}
        </Badge>
      )
    }),

    col.accessor('invitedBy', {
      header: 'Invited by',
      enableSorting: false, // nested object (fullName/email) — no single field to sort by
      cell: info => <Typography variant='body2'>{info.getValue().fullName ?? info.getValue().email ?? '—'}</Typography>
    }),

    col.accessor('expiresAt', {
      header: 'Expires',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2'>
          {new Date(info.getValue()).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })}
        </Typography>
      )
    }),

    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: info => (
        <Badge variant={info.getValue() === 'PENDING' ? 'warning' : 'default'} size='sm'>
          {info.getValue()}
        </Badge>
      )
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        if (!args.isAdmin || row.original.status !== 'PENDING') return null

        const actions: RowAction<Invitation>[] = [
          {
            key: 'cancel',
            type: 'confirmation',
            icon: 'tabler-x',
            color: 'error',
            title: 'Cancel invitation',
            content: `Cancel the invitation sent to ${row.original.email}?`,
            confirmButtonText: 'Cancel invitation',
            onConfirm: () => args.onCancel(row.original.id)
          }
        ]

        return <RowActions row={row.original} actions={actions} />
      }
    }
  ]
}

type Props = { accountId: string }

export function InvitationsTab({ accountId }: Props) {
  const permissions = usePermissions(accountId)
  const cancelInvite = useCancelInvitation(accountId)

  const columns = buildColumns({
    accountId,
    isAdmin: permissions.isAdmin,
    onCancel: id => cancelInvite.mutate(id)
  })

  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params drive `useInvitationsTableList`, which
  // wraps the SAME `useInvitations(accountId)` query `useCancelInvitation`
  // already invalidates (exact key match, no ad hoc `[tableKey, params]`
  // string) — search/sort/pagination happen client-side inside the hook,
  // since the backend's invitations endpoint doesn't support any of those
  // server-side. See decision.md, 2026-09-15, "Phase 2: Invitations
  // converted to props-based table pattern".
  const serverTable = useServerTable(`invitations-${accountId}`)
  const { data, isLoading, error } = useInvitationsTableList(accountId, serverTable.params)

  return (
    <GenericServerTable<Invitation>
      title='Pending invitations'
      columns={columns}
      serverTable={serverTable}
      data={data?.items ?? []}
      isLoading={isLoading}
      error={error}
      total={data?.meta.total ?? 0}
      enableSearch
    />
  )
}
