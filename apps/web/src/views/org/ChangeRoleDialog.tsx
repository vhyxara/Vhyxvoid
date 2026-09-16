'use client'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'

import CustomTextField from '@core/components/mui/TextField'
import { useChangeMemberRole } from '@/api/application/hooks/useMembers'
import { usePermissions } from '@/api/application/hooks/usePermissions'
import { RoleLevel, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import { getMemberEmail, getMemberInitials, type Member } from '@/api/domain/identity/types/member.types'

const schema = yup.object({
  newRoleLevel: yup
    .number()
    .oneOf([RoleLevel.MEMBER, RoleLevel.ADMIN, RoleLevel.OWNER], 'Select a valid role')
    .required('Role is required')
})

type FormValues = yup.InferType<typeof schema>

type Props = {
  open: boolean
  onClose: () => void
  row: Member // full Member object from table
  accountId: string
}

export function ChangeRoleDialog({ open, onClose, row, accountId }: Props) {
  const changeRole = useChangeMemberRole(accountId)
  const permissions = usePermissions(accountId)

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: yupResolver(schema),

    // Pre-fill with member's current role level from nested role object
    defaultValues: { newRoleLevel: row.role.level }
  })

  const onSubmit = (values: FormValues) => {
    changeRole.mutate(
      {
        userId: row.userId,
        data: { newRoleLevel: values.newRoleLevel as RoleLevel }
      },
      {
        onSuccess: () => {
          reset()
          onClose()
        }
      }
    )
  }

  // Cannot assign a role >= own level — mirrors backend canPromoteTo
  const assignableRoles = [
    { label: roleLevelName(RoleLevel.MEMBER), value: RoleLevel.MEMBER },
    { label: roleLevelName(RoleLevel.ADMIN), value: RoleLevel.ADMIN },
    { label: roleLevelName(RoleLevel.OWNER), value: RoleLevel.OWNER }
  ].filter(r => permissions.canPromoteTo(r.value))

  const initials = getMemberInitials(row)

  return (
    <Dialog open={open} onClose={onClose} maxWidth='xs' fullWidth>
      <DialogTitle>Change role</DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '16px !important' }}>
        {/* Member identity */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 13 }}>{initials}</Avatar>
          <Box>
            <Typography variant='body2' fontWeight={500}>
              getMemberName(row)
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              {getMemberEmail(row)}
            </Typography>
          </Box>
        </Box>

        {/* Current role label */}
        <Typography variant='body2' color='text.secondary'>
          Current role:{' '}
          <Typography component='span' fontWeight={500} color='text.primary'>
            {row.roleName}
          </Typography>
        </Typography>

        <Controller
          name='newRoleLevel'
          control={control}
          render={({ field }) => (
            <CustomTextField
              {...field}
              select
              label='New role'
              fullWidth
              error={!!errors.newRoleLevel}
              helperText={errors.newRoleLevel?.message}
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
        <Button onClick={onClose} variant='outlined' color='secondary'>
          Cancel
        </Button>
        <LoadingButton onClick={handleSubmit(onSubmit)} loading={changeRole.isPending} variant='contained'>
          Save
        </LoadingButton>
      </DialogActions>
    </Dialog>
  )
}
