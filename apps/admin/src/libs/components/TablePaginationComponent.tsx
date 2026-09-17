import type { FC } from 'react'

import { Pagination, Select } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'

type TablePaginationProps = {
  total?: number
  currentPage?: number
  limit?: number
  rowsPerPageOptions?: number[]

  handlePageChange: (page: number) => void
  handleLimitChange: (limit: number) => void
}

const TablePaginationComponent: FC<TablePaginationProps> = ({
  total = 0,
  currentPage = 1,
  limit = 10,
  handlePageChange,
  handleLimitChange,
  rowsPerPageOptions = []
}) => {
  const filteredRowCount = total
  const pageIndex = currentPage - 1
  const pageSize = limit

  return (
    <div className='flex justify-between items-center flex-wrap pli-6 border-bs bs-auto py-[12.5px] gap-2'>
      <Typography variant='body2'>
        {`Showing ${
          filteredRowCount === 0 ? 0 : pageIndex * pageSize + 1
        } to ${Math.min((pageIndex + 1) * pageSize, filteredRowCount)} of ${filteredRowCount} entries`}
      </Typography>

      {!!rowsPerPageOptions?.length && (
        <div className='flex justify-between items-center flex-wrap pli-6 border-bs bs-auto py-[12.5px] gap-2'>
          <Typography variant='body2'>Row per page:</Typography>

          <Select value={String(limit)} onValueChange={value => handleLimitChange(Number(value))} size='sm'>
            <Select.Trigger aria-label='Rows per page' style={{ minWidth: 70 }} />
            <Select.Content>
              {rowsPerPageOptions.map(size => (
                <Select.Item key={size} value={String(size)}>
                  {size}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      )}

      <Pagination
        page={currentPage}
        pageCount={Math.max(1, Math.ceil(filteredRowCount / pageSize))}
        onPageChange={handlePageChange}
        showFirstLast
        size='sm'
      />
    </div>
  )
}

export default TablePaginationComponent
