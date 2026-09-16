'use client'
import { useState } from 'react'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'

import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { FeedbackDetailDrawer } from '@/views/feedback/FeedbackDetailDrawer'
import type { FeedbackListItem } from '@/api/domain/feedback/feedback.types'
import { useMyFeedbackTableList } from '@/api/application/hooks/useFeedback'
import { typeLabel, typeColor, statusColor, priorityColor } from '@/utils/feedback.util'

// import type { FeedbackType } from '@/hooks/useFeedbackDialog'

// ── Color helpers ─────────────────────────────────────────────────────────

// function typeColor(type: FeedbackType) {
//   const map = {
//     BUG_REPORT: 'error',
//     UI_ISSUE: 'info',
//     FEATURE_REQUEST: 'warning',
//     GENERAL_FEEDBACK: 'success'
//   } as const

//   return map[type] ?? 'default'
// }

// function statusColor(status: FeedbackStatus) {
//   const map = {
//     OPEN: 'warning',
//     UNDER_REVIEW: 'info',
//     IN_PROGRESS: 'primary',
//     RESOLVED: 'success',
//     CLOSED: 'default',
//     WONT_FIX: 'error'
//   } as const

//   return map[status] ?? 'default'
// }

// function priorityColor(priority: FeedbackPriority) {
//   const map = { LOW: 'default', MEDIUM: 'warning', HIGH: 'error', CRITICAL: 'error' } as const

//   return map[priority] ?? 'default'
// }

// function typeLabel(type: FeedbackType) {
//   return type
//     .replace(/_/g, ' ')
//     .toLowerCase()
//     .replace(/^\w/, c => c.toUpperCase())
// }

// ── Columns ───────────────────────────────────────────────────────────────

const col = createColumnHelper<FeedbackListItem>()

// No column is sortable — the backend (`listMyFeedbackSchema`) has no sortBy
// at all, and this endpoint has real server-side pagination (unlike
// Invitations' fetch-everything-then-slice shape), so client-side sorting
// would only ever be correct within the current page — silently wrong
// across the full dataset. See useMyFeedbackTableList's doc comment /
// decision.md, 2026-09-16, "Phase 2: My Feedback converted".
function buildColumns(onView: (id: string) => void): ColumnDef<FeedbackListItem, any>[] {
  return [
    col.accessor('type', {
      header: 'Type',
      enableSorting: false,
      cell: info => (
        <Chip label={typeLabel(info.getValue())} color={typeColor(info.getValue())} size='small' variant='tonal' />
      )
    }),

    col.accessor('title', {
      header: 'Title',
      enableSorting: false,
      cell: info => (
        <Box>
          <Typography
            variant='body2'
            fontWeight={500}
            sx={{
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {info.getValue()}
          </Typography>
          <Typography
            variant='caption'
            color='text.secondary'
            sx={{
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block'
            }}
          >
            {info.row.original.description}
          </Typography>
        </Box>
      )
    }),

    col.accessor('status', {
      header: 'Status',
      enableSorting: false,
      cell: info => <Chip label={info.getValue()} color={statusColor(info.getValue())} size='small' variant='tonal' />
    }),

    col.accessor('priority', {
      header: 'Priority',
      enableSorting: false,
      cell: info => (
        <Chip label={info.getValue()} color={priorityColor(info.getValue())} size='small' variant='outlined' />
      )
    }),

    col.accessor('createdAt', {
      header: 'Submitted',
      enableSorting: false,
      cell: info => (
        <Typography variant='body2' color='text.secondary'>
          {new Date(info.getValue()).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })}
        </Typography>
      )
    }),

    col.accessor('resolvedAt', {
      header: 'Resolved',
      enableSorting: false,
      cell: info => (
        <Typography variant='body2' color={info.getValue() ? 'success.main' : 'text.secondary'}>
          {info.getValue()
            ? new Date(info.getValue()!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : '—'}
        </Typography>
      )
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const actions: RowAction<FeedbackListItem>[] = [
          {
            key: 'view',
            type: 'click',
            icon: <i className='tabler-eye' />,
            color: 'primary',
            onClick: r => onView(r.id)
          }
        ]

        return <RowActions row={row.original} actions={actions} />
      }
    }
  ]
}

// ── Component ─────────────────────────────────────────────────────────────

export function FeedbackHistoryTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const columns = buildColumns(id => setSelectedId(id))

  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params drive `useMyFeedbackTableList`, a thin
  // adapter over the already-existing `useMyFeedback` hook, keyed through
  // `feedbackKeys.list(params)` — the same factory `useSubmitFeedback`
  // already invalidates via `feedbackKeys.lists()`. Previously this table
  // used the compat shim's disjoint ad hoc key, so a submitted feedback item
  // never appeared here without a manual reload. See decision.md,
  // 2026-09-16, "Phase 2: My Feedback converted".
  const serverTable = useServerTable('my-feedback')
  const { data, isLoading, error } = useMyFeedbackTableList(serverTable.params)

  return (
    <>
      <GenericServerTable<FeedbackListItem>
        title=''
        columns={columns}
        serverTable={serverTable}
        data={data?.items ?? []}
        isLoading={isLoading}
        error={error}
        total={data?.meta.total ?? 0}
        enableSearch={false}
        filtersConfig={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { label: 'Open', value: 'OPEN' },
              { label: 'Under review', value: 'UNDER_REVIEW' },
              { label: 'In progress', value: 'IN_PROGRESS' },
              { label: 'Resolved', value: 'RESOLVED' },
              { label: 'Closed', value: 'CLOSED' }
            ]
          },
          {
            key: 'type',
            label: 'Type',
            options: [
              { label: 'Bug report', value: 'BUG_REPORT' },
              { label: 'Feature request', value: 'FEATURE_REQUEST' },
              { label: 'UI issue', value: 'UI_ISSUE' },
              { label: 'General', value: 'GENERAL_FEEDBACK' }
            ]
          }
        ]}
      />

      <FeedbackDetailDrawer feedbackId={selectedId} onClose={() => setSelectedId(null)} />
    </>
  )
}
