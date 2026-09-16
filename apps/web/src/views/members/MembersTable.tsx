'use client'

import { useState } from 'react'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { Badge, Button } from '@vhyxui/react'

import { Avatar, Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'

import { RoleLevel, roleLevelColor, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import type { Member } from '@/api/domain/identity/types/member.types'
import { useRemoveMember, useMembersTableList } from '@/api/application/hooks/useMembers'
import { usePermissions } from '@/api/application/hooks/usePermissions'
import { RequireRole } from '@/api/domain/identity/guard/RequireRole'

import { ChangeRoleDialog } from './ChangeRoleDialog'
import { InviteMemberDialog } from './InviteMemberDialog'
import { TransferOwnershipDialog } from './TransferOwnershipDialog'

// ── Avatar ────────────────────────────────────────────────────────────────

function MemberAvatar({ member }: { member: Member }) {
  const u = member.user

  const initials =
    u?.firstName && u?.lastName
      ? `${u.firstName[0]}${u.lastName[0]}`.toUpperCase()
      : (u?.email?.[0] ?? '?').toUpperCase()

  return (
    <Avatar size='sm' alt={u?.fullName ?? member.userId}>
      {initials}
    </Avatar>
  )
}

// roleLevelColor() returns MUI-style names ('error' | 'warning' | 'default').
// VhyxUI's Badge has no 'error' variant (only default/success/warning/danger/
// info/outline) — see the same mapping pattern in ApiKeysView/TunnelsView.
function roleBadgeVariant(level: RoleLevel) {
  const c = roleLevelColor(level)

  if (c === 'error') return 'danger' as const
  if (c === 'warning') return 'warning' as const

  return 'default' as const
}

// ── Column builder ────────────────────────────────────────────────────────

const col = createColumnHelper<Member>()

function buildColumns(args: {
  accountId: string
  permissions: ReturnType<typeof usePermissions>
  onRemove: (userId: string) => void
}): ColumnDef<Member, any>[] {
  const { permissions, onRemove, accountId } = args

  return [
    // ── Member identity ──────────────────────────────────────────────────
    // Not sortable: GetAccountMembersUseCase's sort switch has 'name'/'email'
    // cases, but the route's actual Zod validator (getMembersQuerySchema,
    // apps/api/src/modules/identity/application/dto/account.dto.ts) only
    // accepts sortBy 'roleLevel' | 'joinedAt' — those use-case branches are
    // dead code, unreachable through this endpoint. Confirmed live: a real
    // `sortBy=name` request against the running backend returns a 400
    // VALIDATION_ERROR, not a sorted result. Only Role/Joined are sortable.
    col.display({
      id: 'member',
      header: 'Member',
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original

        return (
          <div className='flex items-center gap-3'>
            <MemberAvatar member={m} />
            <div>
              <div className='flex items-center gap-1.5'>
                <Typography variant='body2' style={{ fontWeight: 500, lineHeight: 1.3 }}>
                  {m.user?.fullName ?? m.userId}
                </Typography>
                {m.isYou && (
                  <Badge variant='info' size='sm'>
                    You
                  </Badge>
                )}
              </div>
              <Typography variant='caption'>{m.user?.email ?? ''}</Typography>
            </div>
          </div>
        )
      }
    }),

    // ── Email verified ───────────────────────────────────────────────────
    col.accessor('user', {
      id: 'verified',
      header: 'Verified',
      enableSorting: false, // no matching backend sortBy option
      cell: info => {
        const verified = info.getValue()?.isEmailVerified

        return (
          <Badge variant={verified ? 'success' : 'warning'} size='sm'>
            {verified ? 'Verified' : 'Pending'}
          </Badge>
        )
      }
    }),

    // ── Role ─────────────────────────────────────────────────────────────
    // id is 'roleLevel' to match the backend's sortBy='roleLevel' option.
    col.accessor('role', {
      id: 'roleLevel',
      header: 'Role',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={roleBadgeVariant(row.original.role.level)} size='sm'>
          {roleLevelName(row.original.role.level)}
        </Badge>
      )
    }),

    // ── Joined date ──────────────────────────────────────────────────────
    col.accessor('joinedAt', {
      header: 'Joined',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2'>
          {new Date(info.getValue()).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })}
        </Typography>
      )
    }),

    // ── Actions ──────────────────────────────────────────────────────────
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const member = row.original

        // canManage is computed by the server per row — most reliable source
        const manageable = permissions.canManageRow(member)

        const actions: RowAction<Member>[] = [
          {
            key: 'change-role',
            type: 'dialog',
            icon: <i className='tabler-shield-check' />,
            color: 'primary',
            disabled: () => !manageable || member.isYou,
            dialogComponent: ChangeRoleDialog,
            dialogProps: { accountId }
          },

          // Transfer ownership — only owner can see this, only on non-owner rows
          ...(permissions.isOwner && member.role.level !== RoleLevel.OWNER
            ? ([
                {
                  key: 'transfer',
                  type: 'dialog' as const,
                  icon: <i className='tabler-crown' />,
                  color: 'warning' as const,
                  dialogComponent: TransferOwnershipDialog,
                  dialogProps: { accountId }
                }
              ] satisfies RowAction<Member>[])
            : []),

          {
            key: 'remove',
            type: 'confirmation',
            icon: 'tabler-trash',
            color: 'error',
            title: 'Remove member',
            content: `Remove ${member.user?.fullName ?? 'this member'} from the organization? This cannot be undone.`,
            confirmButtonText: 'Remove',
            disabled: () => !manageable || member.isYou,
            onConfirm: () => onRemove(member.userId)
          }
        ]

        return <RowActions row={member} actions={actions} />
      }
    }
  ]
}

// ── Component ─────────────────────────────────────────────────────────────

type Props = { accountId: string }

export function MembersTable({ accountId }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false)

  const permissions = usePermissions(accountId)
  const removeMember = useRemoveMember(accountId)

  const columns = buildColumns({
    accountId,
    permissions,
    onRemove: userId => removeMember.mutate(userId)
  })

  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params (page/limit/search/sortBy/sortOrder/filters)
  // drive `useMembersTableList`, which is backed by `memberKeys` (the same
  // query-key factory the mutation hooks above invalidate against), not an
  // ad hoc `[tableKey, params]` key. See decision.md, 2026-09-15,
  // "Phase 2 pilot: Members converted to props-based table pattern".
  const serverTable = useServerTable(`members-${accountId}`)
  const { data, isLoading, error } = useMembersTableList(accountId, serverTable.params)

  return (
    <>
      <GenericServerTable<Member>
        title='Members'
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.meta.total ?? 0}
        extra={data?.extra}
        enableRowSelection
        enableSearch
        filtersConfig={[
          {
            key: 'roleLevel',
            label: 'Role',
            options: [
              { label: 'Owner', value: String(RoleLevel.OWNER) },
              { label: 'Admin', value: String(RoleLevel.ADMIN) },
              { label: 'Member', value: String(RoleLevel.MEMBER) }
            ]
          }
        ]}
        renderToolbar={() => (
          <RequireRole accountId={accountId} minLevel={RoleLevel.ADMIN}>
            <Button className='shrink-0' icon={<i className='tabler-user-plus' />} onClick={() => setInviteOpen(true)}>
              Invite member
            </Button>
          </RequireRole>
        )}
      />

      <InviteMemberDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        accountId={accountId}
        permissions={permissions}
      />
    </>
  )
}
