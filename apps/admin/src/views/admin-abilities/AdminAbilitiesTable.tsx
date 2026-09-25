'use client'

import { useState } from 'react'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { Badge, Button } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { useAdminAbilitiesTableList, useDeleteAbility } from '@/api/application/hooks/useAdminAbilities'
import type { AdminAbilitySummary } from '@/api/domain/admin-abilities/admin-ability.types'
import { CreateAbilityDialog } from './CreateAbilityDialog'

const col = createColumnHelper<AdminAbilitySummary>()

function buildColumns(args: { onDelete: (id: string) => Promise<unknown> }): ColumnDef<AdminAbilitySummary, any>[] {
  return [
    col.accessor('action', {
      header: 'Action',
      enableSorting: true,
      cell: info => (
        <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {info.getValue()}
        </Typography>
      )
    }),

    col.accessor('category', {
      header: 'Category',
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
        const ability = row.original

        // canBeDeleted() on the entity is just `!isSystem` -- confirmed by
        // reading AdminAbility.entities.ts directly. The route rejects a
        // system-ability delete with a 400 before even reaching this UI, so
        // disabling the action here matches the real backend guard rather
        // than letting the admin hit the rejection.
        const actions: RowAction<AdminAbilitySummary>[] = [
          {
            key: 'delete',
            type: 'confirmation',
            icon: 'tabler-trash',
            color: 'error',
            title: 'Delete ability',
            // No guard exists against deleting an ability that's currently
            // assigned to one or more roles -- AdminRoleAbility -> AdminAbility
            // is `onDelete: Cascade` (schema.prisma), confirmed by reading it
            // directly, so the delete silently removes the ability from
            // every role that had it. This message states that plainly
            // rather than implying a safe, isolated delete.
            content: `Delete "${ability.action}"? This permanently deletes the ability and removes it from every role it's currently assigned to. This cannot be undone.`,
            confirmButtonText: 'Delete ability',
            disabled: () => ability.isSystem,
            errorFeedbackMessage: 'Failed to delete ability',
            onConfirm: () => args.onDelete(ability.id)
          }
        ]

        return <RowActions row={ability} actions={actions} />
      }
    }
  ]
}

export function AdminAbilitiesTable() {
  const [createOpen, setCreateOpen] = useState(false)

  const serverTable = useServerTable('admin-abilities')
  const { data, isLoading, error } = useAdminAbilitiesTableList(serverTable.params)
  const deleteAbility = useDeleteAbility()

  const columns = buildColumns({
    // mutateAsync: the confirm dialog waits for the request and shows its
    // error (Confirmation's own feedback), so no separate toast here.
    onDelete: id => deleteAbility.mutateAsync(id)
  })

  return (
    <>
      <GenericServerTable<AdminAbilitySummary>
        title='Abilities'
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.total ?? 0}
        enableSearch
        renderToolbar={() => (
          <Button size='sm' icon={<i className='tabler-plus' />} onClick={() => setCreateOpen(true)}>
            Create ability
          </Button>
        )}
      />

      <CreateAbilityDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  )
}
