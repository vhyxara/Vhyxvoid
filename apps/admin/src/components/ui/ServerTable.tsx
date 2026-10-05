'use client'

import type { ReactNode } from 'react'

import { Alert, Input, Pagination, Skeleton, Table, Text, type TableColumn } from '@vhyxui/react'
import { EmptyState } from '@vhyxui/blocks'

import type { Page } from '@/api/platform/types'

type Props<Row> = {
  columns: TableColumn<Row>[]
  query: { data?: Page<Row>; isLoading: boolean; isFetching?: boolean; error: unknown }
  page: number
  onPageChange: (page: number) => void
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  /** Filters, export buttons… */
  toolbar?: ReactNode
  emptyTitle?: string
  emptyDescription?: string
  rowKey?: (row: Row) => string
}

/** A table over a server-paginated admin endpoint ({ items, meta }). */
export function ServerTable<Row extends Record<string, any>>({
  columns,
  query,
  page,
  onPageChange,
  search,
  toolbar,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  rowKey = row => String(row.id)
}: Props<Row>) {
  const items = query.data?.items ?? []
  const meta = query.data?.meta

  return (
    <div className='flex flex-col gap-3'>
      {(search || toolbar) && (
        <div className='flex flex-wrap items-center gap-2'>
          {search && (
            <div className='flex-1 min-is-[14rem] max-is-[24rem]'>
              <Input
                aria-label='Search'
                placeholder={search.placeholder ?? 'Search…'}
                value={search.value}
                onChange={e => search.onChange(e.target.value)}
                size='sm'
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      {query.error ? (
        <Alert variant='danger' title='Could not load this list'>
          {(query.error as Error)?.message ?? 'Unknown error'}
        </Alert>
      ) : query.isLoading ? (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height='2.25rem' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} bordered />
      ) : (
        <div style={{ overflowX: 'auto', opacity: query.isFetching ? 0.7 : 1, transition: 'opacity 120ms' }}>
          <Table
            columns={columns as TableColumn<Record<string, unknown>>[]}
            data={items as Record<string, unknown>[]}
            rowKey={row => rowKey(row as Row)}
            density='compact'
          />
        </div>
      )}

      {meta && meta.total > 0 && (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <Text size='sm' tone='muted'>
            {meta.total.toLocaleString()} result{meta.total === 1 ? '' : 's'}
          </Text>
          {meta.totalPages > 1 && <Pagination page={page} pageCount={meta.totalPages} onPageChange={onPageChange} size='sm' />}
        </div>
      )}
    </div>
  )
}
