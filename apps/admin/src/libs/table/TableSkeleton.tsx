// libs/components/TableSkeleton.tsx
import { Skeleton } from '@/components/vhyxui-shims'

type Props = {
  columns: number
  rows?: number
}

const TableSkeleton = ({ columns, rows = 8 }: Props) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r}>
        {Array.from({ length: columns }).map((_, c) => (
          <td key={c}>
            <Skeleton variant='rectangular' height={32} />
          </td>
        ))}
      </tr>
    ))}
  </>
)

export default TableSkeleton
