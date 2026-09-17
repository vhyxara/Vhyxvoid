import type { ComponentProps, ReactNode } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { GenericServerTable } from './GenericServerTable'
import { useServerTable } from './useServerTable'

// @vhyxui/react is consumed via pnpm `link:` into a separate sibling repo.
// Its components are wrapped in `@vhyxseal/react`'s `withAgentContract` HOC,
// which pulls in *that* repo's own separately-installed React copy — two
// React instances at runtime means two hook dispatchers, so mounting a real
// Button/Badge/Card under this repo's React throws "Invalid hook call" (a
// deeper instance of the same cross-repo duplicate-dependency class of issue
// as decision.md's 2026-09-10 "VhyxUI Form/react-hook-form generic typing
// friction" entry, here at runtime rather than compile time, and not fixable
// from this repo's side). None of what these tests assert on depends on
// VhyxUI's actual rendering, so they're stubbed with plain DOM elements.
vi.mock('@vhyxui/react', () => ({
  Card: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  Badge: ({ children, ...props }: ComponentProps<'span'>) => <span {...props}>{children}</span>,
  Button: ({ children, ...props }: ComponentProps<'button'>) => <button {...props}>{children}</button>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Select: Object.assign((props: { children?: ReactNode }) => <div>{props.children}</div>, {
    Trigger: (props: ComponentProps<'button'>) => <button {...props} />,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children?: ReactNode }) => <div>{children}</div>
  })
}))

type Row = { id: string; name: string }

const col = createColumnHelper<Row>()

const columns: ColumnDef<Row, any>[] = [
  col.accessor('name', { id: 'name', header: 'Name', enableSorting: true }),
  { id: 'actions', header: 'Actions', enableSorting: false, cell: () => 'x' }
]

const ROWS: Row[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' }
]

/**
 * GenericServerTable no longer owns a query (Phase 2 of
 * TABLE_API_ARCHITECTURE_COMPARISON.md) — it takes data/isLoading/error/total
 * as props and `serverTable` (a real `useServerTable(tableKey)` instance) for
 * its UI state. This harness exercises the real hook, exactly like a real
 * caller (e.g. MembersTable) would, rather than hand-mocking its shape.
 */
function Harness(props: {
  tableKey: string
  data?: Row[]
  isLoading?: boolean
  error?: unknown
  total?: number
}) {
  const { tableKey, data = ROWS, isLoading = false, error, total = data.length } = props
  const serverTable = useServerTable(tableKey)

  return (
    <GenericServerTable<Row>
      title='Test table'
      columns={columns}
      serverTable={serverTable}
      data={data}
      isLoading={isLoading}
      error={error}
      total={total}
      enableSearch={false}
      enablePagination={false}
    />
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('GenericServerTable — props-based data contract', () => {
  it('renders rows straight from the `data` prop, with no fetching of its own', () => {
    render(<Harness tableKey='contract-rows' />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Total: 2')).toBeInTheDocument()
  })

  it('shows the empty state when `data` is empty and `isLoading` is false', () => {
    render(<Harness tableKey='contract-empty' data={[]} total={0} />)

    expect(screen.getByText('No records found')).toBeInTheDocument()
  })

  it('shows the error message from the `error` prop, taking priority over rows/loading', () => {
    render(<Harness tableKey='contract-error' error={new Error('boom')} />)

    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('shows the loading skeleton (not the empty state) when `isLoading` is true with no data yet', () => {
    render(<Harness tableKey='contract-loading' data={[]} isLoading total={0} />)

    expect(screen.queryByText('No records found')).not.toBeInTheDocument()
  })
})

describe('GenericServerTable — click-to-sort', () => {
  it('a sortable column header is clickable and cycles asc -> desc -> none', () => {
    render(<Harness tableKey='sort-cycle' />)

    const nameHeader = screen.getByRole('columnheader', { name: 'Name' })
    const sortButton = within(nameHeader).getByRole('button')

    // Unsorted: neutral icon
    expect(sortButton.querySelector('.tabler-arrows-sort')).toBeInTheDocument()

    fireEvent.click(sortButton)
    expect(sortButton.querySelector('.tabler-chevron-up')).toBeInTheDocument()

    fireEvent.click(sortButton)
    expect(sortButton.querySelector('.tabler-chevron-down')).toBeInTheDocument()

    fireEvent.click(sortButton)
    expect(sortButton.querySelector('.tabler-arrows-sort')).toBeInTheDocument()
  })

  it('a non-sortable column header renders no click affordance', () => {
    render(<Harness tableKey='sort-disabled' />)

    const actionsHeader = screen.getByRole('columnheader', { name: 'Actions' })

    expect(within(actionsHeader).queryByRole('button')).not.toBeInTheDocument()
  })

  it('persists the sort choice via useServerTable, driving what a real caller would pass to its query', () => {
    const { unmount } = render(<Harness tableKey='sort-persist' />)

    const sortButton = within(screen.getByRole('columnheader', { name: 'Name' })).getByRole('button')

    fireEvent.click(sortButton)
    unmount()

    // A fresh mount of the same tableKey (e.g. after a real caller's own
    // re-render) picks the persisted sort back up — same guarantee
    // useServerTable already gave callers before this refactor.
    render(<Harness tableKey='sort-persist' />)
    const reopenedButton = within(screen.getByRole('columnheader', { name: 'Name' })).getByRole('button')

    expect(reopenedButton.querySelector('.tabler-chevron-up')).toBeInTheDocument()
  })
})
