'use client'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'

import { Badge } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { RowActions } from '@/libs/table/RowAction'
import type { RowAction } from '@/libs/table/type'
import { useAdminFeedbackTableList } from '@/api/application/hooks/useAdminFeedback'
import type {
  AdminFeedbackListItem,
  FeedbackPriority,
  FeedbackStatus,
  FeedbackType
} from '@/api/domain/admin-feedback/admin-feedback.types'

function statusBadgeVariant(status: FeedbackStatus) {
  if (status === 'RESOLVED') return 'success' as const
  if (status === 'WONT_FIX' || status === 'CLOSED') return 'default' as const
  if (status === 'OPEN') return 'info' as const

  return 'warning' as const
}

function priorityBadgeVariant(priority: FeedbackPriority) {
  if (priority === 'CRITICAL') return 'danger' as const
  if (priority === 'HIGH') return 'warning' as const

  return 'default' as const
}

// GET /admin/feedback has NO sort support at all -- confirmed by reading
// both adminListFeedbackSchema (no sortBy field) and
// PrismaFeedbackRepository directly (orderBy is hardcoded to
// `createdAt: 'desc'`). Every column below is deliberately
// enableSorting: false, not an oversight.
const col = createColumnHelper<AdminFeedbackListItem>()

function buildColumns(args: { onView: (id: string) => void }): ColumnDef<AdminFeedbackListItem, any>[] {
  return [
    col.accessor('title', {
      header: 'Title',
      enableSorting: false,
      cell: info => <Typography variant='body2'>{info.getValue()}</Typography>
    }),

    col.accessor('type', {
      header: 'Type',
      enableSorting: false,
      cell: info => (
        <Badge variant='outline' size='sm'>
          {(info.getValue() as FeedbackType).replaceAll('_', ' ')}
        </Badge>
      )
    }),

    col.accessor('status', {
      header: 'Status',
      enableSorting: false,
      cell: info => (
        <Badge variant={statusBadgeVariant(info.getValue())} size='sm'>
          {info.getValue().replaceAll('_', ' ')}
        </Badge>
      )
    }),

    col.accessor('priority', {
      header: 'Priority',
      enableSorting: false,
      cell: info => (
        <Badge variant={priorityBadgeVariant(info.getValue())} size='sm'>
          {info.getValue()}
        </Badge>
      )
    }),

    {
      id: 'submittedBy',
      header: 'Submitted by',
      enableSorting: false,
      cell: ({ row }) => <Typography variant='body2'>{row.original.user.email}</Typography>
    },

    col.accessor('createdAt', {
      header: 'Created',
      enableSorting: false,
      cell: info =>
        new Date(info.getValue()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    }),

    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const feedback = row.original

        const actions: RowAction<AdminFeedbackListItem>[] = [
          {
            key: 'view',
            type: 'click',
            icon: <i className='tabler-eye' />,
            onClick: r => args.onView(r.id)
          }
        ]

        return <RowActions row={feedback} actions={actions} />
      }
    }
  ]
}

const STATUS_OPTIONS = [
  { label: 'Open', value: 'OPEN' },
  { label: 'Under review', value: 'UNDER_REVIEW' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'Closed', value: 'CLOSED' },
  { label: "Won't fix", value: 'WONT_FIX' }
]

const TYPE_OPTIONS = [
  { label: 'Bug report', value: 'BUG_REPORT' },
  { label: 'Feature request', value: 'FEATURE_REQUEST' },
  { label: 'General feedback', value: 'GENERAL_FEEDBACK' },
  { label: 'UI issue', value: 'UI_ISSUE' }
]

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
  { label: 'Critical', value: 'CRITICAL' }
]

export function AdminFeedbackTable() {
  const router = useRouter()

  const serverTable = useServerTable('admin-feedback')
  const { data, isLoading, error } = useAdminFeedbackTableList(serverTable.params)

  const columns = buildColumns({ onView: id => router.push(`/feedback/${id}`) })
  const counts = data?.extra?.counts

  return (
    <GenericServerTable<AdminFeedbackListItem>
      title='Feedback Triage'
      columns={columns}
      serverTable={serverTable}
      data={data?.items ?? []}
      isLoading={isLoading}
      error={error}
      total={data?.meta.total ?? 0}
      // No search -- GET /admin/feedback has no search param at all.
      enableSearch={false}
      filtersConfig={[
        { key: 'status', label: 'Status', options: STATUS_OPTIONS },
        { key: 'type', label: 'Type', options: TYPE_OPTIONS },
        { key: 'priority', label: 'Priority', options: PRIORITY_OPTIONS }
      ]}
      renderToolbar={() =>
        counts ? (
          <div className='flex gap-2 flex-wrap'>
            <Badge variant='info' size='sm'>{`Open: ${counts.open}`}</Badge>
            <Badge variant='warning' size='sm'>{`Under review: ${counts.underReview}`}</Badge>
            <Badge variant='warning' size='sm'>{`In progress: ${counts.inProgress}`}</Badge>
            <Badge variant='success' size='sm'>{`Resolved: ${counts.resolved}`}</Badge>
          </div>
        ) : null
      }
    />
  )
}
