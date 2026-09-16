'use client'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Typography from '@mui/material/Typography'

import CustomTextField from '@core/components/mui/TextField'
import { useInviteMember } from '@/api/application/hooks/useMembers'
import { RoleLevel, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import { inviteSchema, type InviteFormValues } from '@/api/domain/identity/schemas/invite.schema'
import type { Permissions } from '@/api/application/hooks/usePermissions'

type Props = {
  open: boolean
  onClose: () => void
  accountId: string
  permissions: Permissions
}

export function InviteMemberDialog({ open, onClose, accountId, permissions }: Props) {
  const invite = useInviteMember(accountId)

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<InviteFormValues>({
    resolver: yupResolver(inviteSchema),
    defaultValues: { email: '', roleLevel: RoleLevel.MEMBER }
  })

  const onSubmit = (values: InviteFormValues) => {
    invite.mutate(
      { email: values.email, roleLevel: values.roleLevel as RoleLevel },
      {
        onSuccess: () => {
          reset()
          onClose()
        }
      }
    )
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // Only show roles the actor can actually assign
  const assignableRoles = [
    { label: roleLevelName(RoleLevel.MEMBER), value: RoleLevel.MEMBER },
    { label: roleLevelName(RoleLevel.ADMIN), value: RoleLevel.ADMIN }
  ].filter(r => permissions.canPromoteTo(r.value))

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='xs' fullWidth>
      <DialogTitle>Invite member</DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '16px !important' }}>
        <Typography variant='body2' color='text.secondary'>
          An invitation link will be sent to their email address.
        </Typography>

        <Controller
          name='email'
          control={control}
          render={({ field }) => (
            <CustomTextField
              {...field}
              label='Email address'
              type='email'
              autoFocus
              fullWidth
              error={!!errors.email}
              helperText={errors.email?.message}
            />
          )}
        />

        <Controller
          name='roleLevel'
          control={control}
          render={({ field }) => (
            <CustomTextField
              {...field}
              select
              label='Role'
              fullWidth
              error={!!errors.roleLevel}
              helperText={errors.roleLevel?.message}
            >
              {assignableRoles.map(r => (
                <MenuItem key={r.value} value={r.value}>
                  {r.label}
                </MenuItem>
              ))}
            </CustomTextField>
          )}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose} variant='outlined' color='secondary'>
          Cancel
        </Button>
        <LoadingButton onClick={handleSubmit(onSubmit)} loading={invite.isPending} variant='contained'>
          Send invite
        </LoadingButton>
      </DialogActions>
    </Dialog>
  )
}
