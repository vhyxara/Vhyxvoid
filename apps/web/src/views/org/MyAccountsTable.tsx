'use client'
import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

import { Box } from '@mui/material'

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
        <Box>
          <Typography variant='body2' fontWeight={500}>
            {row.original.accountName ?? 'Personal account'}
          </Typography>
          <Typography variant='caption' color='text.secondary' fontFamily='monospace'>
            {row.original.accountType} · {row.original.accountStatus}
          </Typography>
        </Box>
      )
    }),

    col.accessor('roleLevel', {
      header: 'Your role',
      enableSorting: true,
      cell: info => (
        <Chip
          label={roleLevelName(info.getValue())}
          color={roleLevelColor(info.getValue())}
          size='small'
          variant='tonal'
        />
      )
    }),

    col.accessor('joinedAt', {
      header: 'Joined',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2' color='text.secondary'>
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
          <Button variant='contained' startIcon={<i className='tabler-plus' />} onClick={() => setCreateOpen(true)}>
            New organization
          </Button>
        )}
      />

      <CreateOrgDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
