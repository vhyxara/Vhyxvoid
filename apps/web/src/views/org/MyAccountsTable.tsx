'use client'
import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Badge, Button } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { roleLevelName, roleLevelColor, RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { useMyAccountsTableList } from '@/api/application/hooks/useMe'
import { CreateOrgDialog } from './CreateOrgDialog'
import type { MyAccount } from '@/api/domain/identity/types/org.types'

// ── Column definitions ────────────────────────────────────────────────────

const col = createColumnHelper<MyAccount>()

// roleLevelColor() returns MUI-style names ('error' | 'warning' | 'default').
// VhyxUI's Badge has no 'error' variant — same mapping as MembersTable.tsx's
// roleBadgeVariant.
function roleBadgeVariant(level: RoleLevel) {
  const c = roleLevelColor(level)

  if (c === 'error') return 'danger' as const
  if (c === 'warning') return 'warning' as const

  return 'default' as const
}

function buildColumns(onNavigate: (accountId: string) => void): ColumnDef<MyAccount, any>[] {
  return [
    // col.accessor('accountId', {
    //   header: 'Account ID',
    //   cell: info => (
    //     <Typography variant='body2' fontFamily='monospace' fontSize={12}>
    //       {info.getValue()}
    //     </Typography>
    //   )
    // }),

    col.accessor('accountName', {
      header: 'Organization',
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <Typography variant='body2' style={{ fontWeight: 500 }}>
            {row.original.accountName ?? 'Personal account'}
          </Typography>
          <Typography
            variant='caption'
            style={{ color: 'var(--vhyx-color-text-subtle)', fontFamily: 'monospace', display: 'block' }}
          >
            {row.original.accountType} · {row.original.accountStatus}
          </Typography>
        </div>
      )
    }),

    col.accessor('roleLevel', {
      header: 'Your role',
      enableSorting: true,
      cell: info => (
        <Badge variant={roleBadgeVariant(info.getValue())} size='sm'>
          {roleLevelName(info.getValue())}
        </Badge>
      )
    }),

    col.accessor('joinedAt', {
      header: 'Joined',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
          {new Date(info.getValue()).toLocaleDateString()}
        </Typography>
      )
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const actions: RowAction<MyAccount>[] = [
          {
            key: 'open',
            type: 'click',
            icon: <i className='tabler-arrow-right' />,
            color: 'primary',
            onClick: r => onNavigate(r.accountId)
          }
        ]

        return <RowActions row={row.original} actions={actions} />
      }
    }
  ]
}

// ── Component ─────────────────────────────────────────────────────────────

export function MyAccountsTable() {
  const [createOpen, setCreateOpen] = useState(false)
  const router = useRouter()

  const columns = buildColumns(accountId => router.push(`/organizations/${accountId}/members`))

  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params drive `useMyAccountsTableList`, which wraps
  // the SAME `useMyAccounts()` query every mutation hook's `meKeys.detail()`
  // invalidation now correctly reaches (exact key match, no ad hoc
  // `[tableKey, params]` string) — search/role-filter/sort/pagination happen
  // client-side inside the hook, since GET /account/me has no server-side
  // support for any of them. See decision.md, 2026-09-16, "Phase 2: My
  // Organizations converted" and "...accountKeys.all invalidation was a dead
  // target, fixed".
  const serverTable = useServerTable('my-accounts')
  const { data, isLoading, error } = useMyAccountsTableList(serverTable.params)

  return (
    <>
      <GenericServerTable<MyAccount>
        title='My organizations'
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.meta.total ?? 0}
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
          <Button icon={<i className='tabler-plus' />} onClick={() => setCreateOpen(true)}>
            New organization
          </Button>
        )}
      />

      <CreateOrgDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
