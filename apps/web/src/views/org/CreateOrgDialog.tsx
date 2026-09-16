'use client'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Typography from '@mui/material/Typography'

import CustomTextField from '@core/components/mui/TextField'
import { useCreateOrg } from '@/api/application/hooks/useOrg'

import { type CreateOrgFormValues, createOrgSchema } from '@/api/domain/identity/schemas/createOrg.schema'

type Props = {
  open: boolean
  onClose: () => void
}

export function CreateOrgDialog({ open, onClose }: Props) {
  const createOrg = useCreateOrg()

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<CreateOrgFormValues>({
    resolver: yupResolver(createOrgSchema),
    defaultValues: { name: '' }
  })

  const onSubmit = (values: CreateOrgFormValues) => {
    createOrg.mutate(values, {
      // The full-page reload this used to do is no longer needed —
      // useCreateOrg's onSuccess now invalidates meKeys.detail() (the real
      // cache entry the sidebar/My Organizations table read from;
      // accountKeys.all was a dead invalidation target, fixed 2026-09-16)
      // and navigates to the new org itself. See decision.md, "Phase 2: My
      // Organizations — accountKeys.all invalidation was a dead target,
      // fixed".
      onSuccess: () => {
        reset()
        onClose()
      }
    })
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='xs' fullWidth>
      <DialogTitle>Create organization</DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '16px !important' }}>
        <Typography variant='body2' color='text.secondary'>
          Organizations let you collaborate with a team under shared billing and role-based access.
        </Typography>

        <Controller
          name='name'
          control={control}
          render={({ field }) => (
            <CustomTextField
              {...field}
              label='Organization name'
              autoFocus
              fullWidth
              error={!!errors.name}
              helperText={errors.name?.message}
              placeholder='e.g. Acme Corp'
            />
          )}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose} variant='outlined' color='secondary'>
          Cancel
        </Button>
        <LoadingButton onClick={handleSubmit(onSubmit)} loading={createOrg.isPending} variant='contained'>
          Create
        </LoadingButton>
      </DialogActions>
    </Dialog>
  )
}
