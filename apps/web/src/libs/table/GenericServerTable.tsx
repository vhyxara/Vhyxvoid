'use client'
import { type ReactNode, useState } from 'react'

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState
} from '@tanstack/react-table'

import { Badge, Button, Card, Input, Select } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import tableStyles from '@core/styles/table.module.css'

import TableSkeleton from '@/libs/table/TableSkeleton'
import TablePaginationComponent from '@/libs/components/TablePaginationComponent'
import type { useServerTable } from '@/libs/table/useServerTable'
import { useBulkSelection } from './tableUtility'
import { useMounted } from '@/hooks/mountFlag'

/* ---------- Generic Types ---------- */

export type FetchParams = {
  page: number
  limit: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  filters?: Record<string, string>
}

type FilterOption = {
  label: string
  value: string
}

type TableFilter = {
  key: string
  label: string
  options: FilterOption[]
}

/* ---------- Reusable Generic Table Component ---------- */

/**
 * Data-fetching moved OUT of this component (Phase 2 of
 * TABLE_API_ARCHITECTURE_COMPARISON.md's recommendation) — it now takes
 * `data`/`isLoading`/`error`/`total` as props, matching kautilyan-frontend's
 * `DataTable` ownership model, while keeping this component's own richer
 * feature set (`useServerTable`'s persisted/debounced state, `RowAction`/
 * `BulkActions`, pagination). The caller owns `useServerTable(tableKey)` and
 * a real query (ideally backed by the resource's own query-key factory, e.g.
 * `useMembersTableList` — not an ad hoc `[tableKey, params]` key) and passes
 * both down. See decision.md, 2026-09-15, "Phase 2 pilot: Members converted
 * to props-based table pattern" for why this changed and what it fixes.
 */
export function GenericServerTable<TData extends { id: number | string }, TExtra = unknown>({
  title,
  columns,
  serverTable,
  data,
  isLoading,
  error,
  total,
  extra,
  enableSearch = true,
  enablePagination = true,
  enableRowSelection = false,
  renderToolbar,
  filtersConfig
}: GenericServerTableProps<TData, TExtra>) {
  const { page, limit, search, sorting, setPage, setLimit, setSearch, setSorting, setFilters, filters, reset } =
    serverTable

  const mount = useMounted()

  const rows = data

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  const bulkSelection = useBulkSelection(rows, rowSelection)
  const selectedIds = enableRowSelection ? bulkSelection.selectedIds : []

  const table = useReactTable<TData>({
    data: rows,
    columns,
    state: {
      sorting,
      ...(enableRowSelection && { rowSelection }),
      pagination: {
        pageIndex: page - 1,
        pageSize: limit
      }
    },
    onRowSelectionChange: enableRowSelection ? setRowSelection : undefined,

    onSortingChange: updater => setSorting(old => (typeof updater === 'function' ? updater(old) : updater)),

    manualSorting: true,
    manualPagination: true,
    getRowId: row => String(row.id),

    getCoreRowModel: getCoreRowModel()
  })

  if (!mount) return null

  return (
    <Card>
      {title && (
        <div className='flex justify-between px-4 pt-2'>
          <Typography variant='h6'>{title}</Typography>
        </div>
      )}

      <div className='flex justify-between gap-3 p-4 flex-wrap'>
        <div className='flex items-end gap-2 flex-wrap'>
          {enableSearch && (
            <Input
              className='shrink-0'
              placeholder='Search...'
              value={search}
              onChange={e => setSearch(e.target.value)}
              icon={<i className='tabler-search text-xl' />}
              iconPosition='right'
            />
          )}

          {filtersConfig?.map(filter => (
            <Select
              key={filter.key}
              className='shrink-0'
              value={filters[filter.key] || ''}
              onValueChange={value => setFilters({ ...filters, [filter.key]: value })}
              placeholder={filter.label}
            >
              <Select.Trigger aria-label={filter.label} style={{ minWidth: 150 }} />
              <Select.Content>
                <Select.Item value=''>All</Select.Item>
                {filter.options.map(option => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          ))}

          <Button className='shrink-0' variant='ghost' size='sm' onClick={() => reset()}>
            Clear Filters
          </Button>

          <Badge className='shrink-0' variant='default'>{`Total: ${total}`}</Badge>
        </div>
        <div className='flex items-center gap-2'>
          {renderToolbar?.({
            selectedIds,
            clearSelection: () => setRowSelection({}),
            extra
          })}
        </div>
      </div>

      <div className='overflow-x-auto'>
        <table className={tableStyles.table}>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => {
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()

                  return (
                    <th key={header.id}>
                      {canSort ? (
                        <button
                          type='button'
                          onClick={header.column.getToggleSortingHandler()}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            font: 'inherit',
                            color: 'inherit',
                            textTransform: 'inherit',
                            letterSpacing: 'inherit',
                            cursor: 'pointer'
                          }}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <i
                            className={
                              sortDir === 'asc'
                                ? 'tabler-chevron-up text-sm'
                                : sortDir === 'desc'
                                  ? 'tabler-chevron-down text-sm'
                                  : 'tabler-arrows-sort text-sm'
                            }
                            style={{ opacity: sortDir ? 1 : 0.5 }}
                          />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {error ? (
              <tr>
                <td colSpan={columns.length} className='text-center text-red-500 py-6'>
                  {(error as Error).message}
                </td>
              </tr>
            ) : isLoading ? (
              <TableSkeleton columns={columns.length} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className='text-center'>
                  No records found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {enablePagination && (
        <TablePaginationComponent
          total={total}
          currentPage={page}
          limit={limit}
          handlePageChange={setPage}
          handleLimitChange={newLimit => {
            setLimit(newLimit)
            setPage(1)
          }}
          rowsPerPageOptions={[10, 20, 30, 40, 50]}
        />
      )}
    </Card>
  )
}

type GenericServerTableProps<TData extends object, TExtra> = {
  title?: string
  columns: ColumnDef<TData, any>[]

  // Table UI state (page/limit/search/sorting/filters — persisted + debounced).
  // Owned by the caller via `useServerTable(tableKey)`, since the caller also
  // needs it to drive its own data-fetching hook.
  serverTable: ReturnType<typeof useServerTable>

  // Data-fetching — owned by the caller, not this component. See the
  // component doc comment above.
  data: TData[]
  isLoading: boolean
  error?: unknown
  total: number
  extra?: TExtra

  // Feature flags
  enableSearch?: boolean
  enablePagination?: boolean
  enableRowSelection?: boolean

  // Custom UI
  renderToolbar?: (ctx: {
    selectedIds: Array<string | number>
    clearSelection: () => void
    extra?: TExtra
  }) => ReactNode
  filtersConfig?: TableFilter[]
}
