import { MenuItem, Select, Stack, Typography } from '@mui/material'

type Props = {
  limit: number
  onChange: (limit: number) => void
  options?: number[]
}

export default function TablePageSize({ limit, onChange, options = [10, 20, 50, 100] }: Props) {
  return (
    <Stack direction='row' spacing={1} alignItems='center'>
      <Typography variant='body2'>Rows per page:</Typography>

      <Select size='small' value={limit} onChange={e => onChange(Number(e.target.value))}>
        {options.map(opt => (
          <MenuItem key={opt} value={opt}>
            {opt}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  )
}
