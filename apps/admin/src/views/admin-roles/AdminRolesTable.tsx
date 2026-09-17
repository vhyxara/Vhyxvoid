'use client'

import { useState } from 'react'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'

import { Badge, Button } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { useAdminRolesTableList } from '@/api/application/hooks/useAdminRoles'
import type { AdminRoleSummary } from '@/api/domain/admin-roles/admin-role.types'
import { CreateRoleDialog } from './CreateRoleDialog'

const col = createColumnHelper<AdminRoleSummary>()

function buildColumns(args: { onView: (id: string) => void }): ColumnDef<AdminRoleSummary, any>[] {
  return [
    col.accessor('name', {
      header: 'Name',
      enableSorting: true,
      cell: info => <Typography variant='body2'>{info.getValue()}</Typography>
    }),

    col.accessor('description', {
      header: 'Description',
      enableSorting: false,
      cell: info => <Typography variant='body2'>{info.getValue() || '—'}</Typography>
    }),

    col.accessor('isSystem', {
      header: 'Type',
      enableSorting: true,
      cell: info => (
        <Badge variant={info.getValue() ? 'info' : 'default'} size='sm'>
          {info.getValue() ? 'System' : 'Custom'}
        </Badge>
      )
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const role = row.original

        const actions: RowAction<AdminRoleSummary>[] = [
          {
            key: 'view',
            type: 'click',
            icon: <i className='tabler-eye' />,
            onClick: r => args.onView(r.id)
          }
        ]

        return <RowActions row={role} actions={actions} />
      }
    }
  ]
}

export function AdminRolesTable() {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)

  const serverTable = useServerTable('admin-roles')
  const { data, isLoading, error } = useAdminRolesTableList(serverTable.params)

  const columns = buildColumns({ onView: id => router.push(`/roles/${id}`) })

  return (
    <>
      <GenericServerTable<AdminRoleSummary>
        title='Roles'
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.total ?? 0}
        enableSearch
        renderToolbar={() => (
          <Button size='sm' icon={<i className='tabler-plus' />} onClick={() => setCreateOpen(true)}>
            Create role
          </Button>
        )}
      />

      <CreateRoleDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
