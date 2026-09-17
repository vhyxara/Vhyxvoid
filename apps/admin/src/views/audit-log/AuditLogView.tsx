'use client'

import { Fragment, useMemo, useState } from 'react'

import { Badge, Button, Card, Input, Select } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { usePersistedState } from '@/libs/table/tableUtility'
import TableSkeleton from '@/libs/table/TableSkeleton'
import tableStyles from '@core/styles/table.module.css'
import { useAdminUsers } from '@/api/application/hooks/useAdminUsers'
import { useAdminAuditLogList, type AuditLogFilter, type AuditLogFilterType } from '@/api/application/hooks/useAdminAuditLog'
import type { AdminAuditLogEntry } from '@/api/domain/admin-audit-log/admin-audit-log.types'

const COLUMN_COUNT = 5

type State = {
  page: number
  limit: number
  filter: AuditLogFilter
}

const DEFAULT_STATE: State = {
  page: 1,
  limit: 10,
  filter: { type: 'none', value: '' }
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function DetailPanel({ entry }: { entry: AdminAuditLogEntry }) {
  const hasMetadata = !!entry.metadata
  const hasChanges = !!entry.changes

  if (!hasMetadata && !hasChanges) {
    return (
      <Typography variant='body2' style={{ opacity: 0.7 }}>
        No metadata or before/after changes were recorded for this entry.
      </Typography>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      {hasMetadata && (
        <div>
          <Typography variant='caption' style={{ fontWeight: 600 }}>
            Request metadata
          </Typography>
          <div className='flex gap-4 flex-wrap' style={{ marginTop: 4 }}>
            {entry.metadata?.ipAddress && <Typography variant='body2'>IP: {entry.metadata.ipAddress}</Typography>}
            {entry.metadata?.statusCode !== undefined && (
              <Typography variant='body2'>Status: {entry.metadata.statusCode}</Typography>
            )}
            {entry.metadata?.userAgent && (
              <Typography variant='body2' style={{ wordBreak: 'break-all' }}>
                User agent: {entry.metadata.userAgent}
              </Typography>
            )}
            {entry.metadata?.reason && <Typography variant='body2'>Reason: {entry.metadata.reason}</Typography>}
          </div>
        </div>
      )}

      {hasChanges && (
        <div className='flex gap-4 flex-wrap' style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Typography variant='caption' style={{ fontWeight: 600 }}>
              Before
            </Typography>
            <pre style={{ fontSize: 12, overflowX: 'auto', margin: 0 }}>
              {entry.changes?.before === null ? '(none)' : JSON.stringify(entry.changes?.before, null, 2)}
            </pre>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Typography variant='caption' style={{ fontWeight: 600 }}>
              After
            </Typography>
            <pre style={{ fontSize: 12, overflowX: 'auto', margin: 0 }}>
              {entry.changes?.after === null ? '(none)' : JSON.stringify(entry.changes?.after, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function AuditLogView() {
  const { value: state, setValue: setState } = usePersistedState<State>('table:audit-log', DEFAULT_STATE)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { items, hasNextPage, isLoading, error } = useAdminAuditLogList(state.filter, state.page, state.limit)

  // Used both to populate the "by admin" filter dropdown and to resolve
  // each row's raw adminId into a real email -- no status filter, so this
  // includes disabled admins too (an audit entry can reference one).
  const { data: admins } = useAdminUsers()
  const adminEmailById = useMemo(() => {
    const map = new Map<string, string>()

    admins?.forEach(a => map.set(a.id, a.email))

    return map
  }, [admins])

  const setFilterType = (type: AuditLogFilterType) => setState(prev => ({ ...prev, page: 1, filter: { type, value: '' } }))
  const setFilterValue = (value: string) => setState(prev => ({ ...prev, page: 1, filter: { ...prev.filter, value } }))
  const setPage = (page: number) => setState(prev => ({ ...prev, page }))
  const setLimit = (limit: number) => setState(prev => ({ ...prev, limit, page: 1 }))
  const clearFilter = () => setState(prev => ({ ...prev, page: 1, filter: { type: 'none', value: '' } }))

  return (
    <Card>
      <div className='flex justify-between px-4 pt-2'>
        <Typography variant='h6'>Audit Log</Typography>
      </div>

      <div className='flex justify-between gap-3 p-4 flex-wrap'>
        <div className='flex items-end gap-2 flex-wrap'>
          <Select value={state.filter.type} onValueChange={value => setFilterType(value as AuditLogFilterType)}>
            <Select.Trigger aria-label='Filter by' style={{ minWidth: 150 }} />
            <Select.Content>
              <Select.Item value='none'>No filter</Select.Item>
              <Select.Item value='admin'>By admin</Select.Item>
              <Select.Item value='action'>By action</Select.Item>
              <Select.Item value='target'>By target ID</Select.Item>
            </Select.Content>
          </Select>

          {state.filter.type === 'admin' && (
            <Select value={state.filter.value} onValueChange={setFilterValue}>
              <Select.Trigger aria-label='Admin' style={{ minWidth: 220 }} />
              <Select.Content>
                {(admins ?? []).map(a => (
                  <Select.Item key={a.id} value={a.id}>
                    {a.email}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          )}

          {state.filter.type === 'action' && (
            <Input
              placeholder='e.g. role.created'
              value={state.filter.value}
              onChange={e => setFilterValue(e.target.value)}
              style={{ minWidth: 220 }}
            />
          )}

          {state.filter.type === 'target' && (
            <Input
              placeholder='Target ID (UUID)'
              value={state.filter.value}
              onChange={e => setFilterValue(e.target.value)}
              style={{ minWidth: 260 }}
            />
          )}

          {state.filter.type !== 'none' && (
            <Button variant='ghost' size='sm' onClick={clearFilter}>
              Clear filter
            </Button>
          )}
        </div>

        {/* No "Total: N" badge here -- GET /audit-logs has no total/count
            field at all (confirmed by reading AdminAuditLogRepository
            directly and via curl), unlike every other table in this app.
            Showing a badge with a fabricated total would misrepresent what
            the backend actually knows. */}
        <Select value={String(state.limit)} onValueChange={value => setLimit(Number(value))}>
          <Select.Trigger aria-label='Rows per page' style={{ minWidth: 70 }} />
          <Select.Content>
            {[10, 20, 50].map(size => (
              <Select.Item key={size} value={String(size)}>
                {size}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      <div className='overflow-x-auto'>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>

          <tbody>
            {error ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className='text-center text-red-500 py-6'>
                  {(error as Error).message}
                </td>
              </tr>
            ) : isLoading ? (
              <TableSkeleton columns={COLUMN_COUNT} />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className='text-center'>
                  No audit log entries found
                </td>
              </tr>
            ) : (
              items.map(entry => (
                <Fragment key={entry.id}>
                  <tr>
                    <td>
                      <Typography variant='body2'>{formatTimestamp(entry.createdAt)}</Typography>
                    </td>
                    <td>
                      <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {adminEmailById.get(entry.adminId) ?? entry.adminId}
                      </Typography>
                    </td>
                    <td>
                      <Typography variant='body2'>{entry.actionDescription}</Typography>
                    </td>
                    <td>
                      <div className='flex items-center gap-1'>
                        <Badge variant='outline' size='sm'>
                          {entry.targetType}
                        </Badge>
                        {entry.targetId && (
                          <Typography variant='body2' style={{ fontFamily: 'monospace', fontSize: 11 }}>
                            {entry.targetId.slice(0, 8)}…
                          </Typography>
                        )}
                      </div>
                    </td>
                    <td>
                      <Button
                        variant='ghost'
                        size='sm'
                        icon={<i className={expandedId === entry.id ? 'tabler-chevron-up' : 'tabler-chevron-down'} />}
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      >
                        {expandedId === entry.id ? 'Hide' : 'View'}
                      </Button>
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr>
                      <td colSpan={COLUMN_COUNT} style={{ background: 'var(--vhyx-color-surface-secondary, transparent)' }}>
                        <DetailPanel entry={entry} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* A plain Previous/Next pager, not TablePaginationComponent -- that
          component requires a real `total` to compute page count and
          render "Showing X to Y of Z entries", which this endpoint cannot
          honestly provide. `hasNextPage` comes from over-fetching one extra
          row per page (see useAdminAuditLogList), not a real total. */}
      <div className='flex justify-between items-center px-6 py-3'>
        <Typography variant='body2'>Page {state.page}</Typography>
        <div className='flex gap-2'>
          <Button variant='secondary' size='sm' disabled={state.page === 1} onClick={() => setPage(state.page - 1)}>
            Previous
          </Button>
          <Button variant='secondary' size='sm' disabled={!hasNextPage} onClick={() => setPage(state.page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </Card>
  )
}
