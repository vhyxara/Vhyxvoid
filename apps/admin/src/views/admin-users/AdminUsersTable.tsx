'use client'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'

import { Badge } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { useAdminUsersTableList, useDisableAdmin, useEnableAdmin } from '@/api/application/hooks/useAdminUsers'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import type { AdminUserSummary } from '@/api/domain/admin-users/admin-user.types'

function formatLastLogin(value: string | null): string {
  if (!value) return 'Never'

  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const col = createColumnHelper<AdminUserSummary>()

function buildColumns(args: {
  currentAdminId: string | undefined
  onView: (id: string) => void
  onDisable: (row: AdminUserSummary) => void
  onEnable: (row: AdminUserSummary) => void
}): ColumnDef<AdminUserSummary, any>[] {
  return [
    col.accessor('fullName', {
      header: 'Name',
      enableSorting: true,
      cell: info => <Typography variant='body2'>{info.getValue()}</Typography>
    }),

    col.accessor('email', {
      header: 'Email',
      enableSorting: true,
      cell: info => <Typography variant='body2'>{info.getValue()}</Typography>
    }),

    col.accessor('isSuperAdmin', {
      header: 'Role',
      enableSorting: false, // a single boolean flag -- not a meaningful sort dimension
      cell: info => (
        <Badge variant={info.getValue() ? 'info' : 'default'} size='sm'>
          {info.getValue() ? 'Super Admin' : 'Admin'}
        </Badge>
      )
    }),

    col.accessor('status', {
      header: 'Status',
      enableSorting: true,
      cell: info => (
        <Badge variant={info.getValue() ? 'success' : 'danger'} size='sm'>
          {info.getValue() ? 'Active' : 'Disabled'}
        </Badge>
      )
    }),

    col.accessor('lastLoginAt', {
      header: 'Last login',
      enableSorting: true,
      cell: info => <Typography variant='body2'>{formatLastLogin(info.getValue())}</Typography>
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const admin = row.original
        const isSelf = admin.id === args.currentAdminId

        const actions: RowAction<AdminUserSummary>[] = [
          {
            key: 'view',
            type: 'click',
            icon: <i className='tabler-eye' />,
            onClick: r => args.onView(r.id)
          }
        ]

        if (admin.status) {
          actions.push({
            key: 'disable',
            type: 'confirmation',
            icon: 'tabler-ban',
            color: 'error',
            title: 'Disable admin',
            content: `Disable ${admin.fullName}'s access? They will be unable to log in until re-enabled.`,
            confirmButtonText: 'Disable',
            // Backend rejects disabling a super admin (AdminUser.disable()
            // throws) and disabling your own account would lock you out --
            // both disabled here rather than letting the request fail.
            disabled: () => admin.isSuperAdmin || isSelf,
            onConfirm: () => args.onDisable(admin)
          })
        } else {
          actions.push({
            key: 'enable',
            type: 'confirmation',
            icon: 'tabler-check',
            color: 'success',
            title: 'Enable admin',
            content: `Re-enable ${admin.fullName}'s access?`,
            confirmButtonText: 'Enable',
            confirmButtonColor: 'success',
            onConfirm: () => args.onEnable(admin)
          })
        }

        return <RowActions row={admin} actions={actions} />
      }
    }
  ]
}

export function AdminUsersTable() {
  const router = useRouter()
  const currentAdminId = useAdminAuthStore(s => s.admin?.id)

  const serverTable = useServerTable('admin-users')
  const { data, isLoading, error } = useAdminUsersTableList(serverTable.params)

  const disableAdmin = useDisableAdmin()
  const enableAdmin = useEnableAdmin()

  const columns = buildColumns({
    currentAdminId,
    onView: id => router.push(`/admin-users/${id}`),
    onDisable: row => disableAdmin.mutate(row.id),
    onEnable: row => enableAdmin.mutate(row.id)
  })

  return (
    <GenericServerTable<AdminUserSummary>
      title='Admin Users'
      columns={columns}
      serverTable={serverTable}
      data={data?.items ?? []}
      isLoading={isLoading}
      error={error}
      total={data?.total ?? 0}
      enableSearch
      filtersConfig={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { label: 'Active', value: 'true' },
            { label: 'Disabled', value: 'false' }
          ]
        }
      ]}
    />
  )
}
