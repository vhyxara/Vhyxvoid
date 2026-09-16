import {  Stack, Typography } from '@mui/material'

import Confirmation from '../components/Confirmation'

import type { ConfirmationProps } from '../components/Confirmation'
import IconButton from '@/@core/components/mui/IconButton'

type Action = Omit<ConfirmationProps, 'onConfirm'> & {
  key: string
  onConfirm: (selectedIds: string[]) => void
}

type Props = {
  selectedIds: string[]
  actions: Action[]
  clearSelection: () => void
}

export function BulkActions({ selectedIds, actions, clearSelection, ...props }: Props) {
  if (selectedIds.length === 0) return null

  return (
    <Stack direction='row' spacing={1} alignItems='center' className='border-b-2'>
      <Typography fontWeight={500}>{selectedIds.length} selected</Typography>

      {actions.map(action => (
        <Confirmation
          key={action.key}
          title={`${action.title || 'Are you sure?'} (${selectedIds.length})`}
          content={action.content || 'This action cannot be undone.'}
          confirmButtonText={`${action.buttonText} (${selectedIds.length})`}
          confirmButtonColor={action.confirmButtonColor || 'error'}
          onConfirm={() => {
            // await bulkDeleteMutation.mutateAsync(selectedIds)
            action.onConfirm(selectedIds)
          }}
          onSuccessCallback={() => clearSelection()}
          {...props}
        />
      ))}

      <IconButton onClick={clearSelection} className='rounded-full'>
        <i className='tabler-x' />
      </IconButton>
    </Stack>
  )
}
