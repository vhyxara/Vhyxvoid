'use client'
import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Button, Dialog, Form, Select } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useChangeMemberRole } from '@/api/application/hooks/useMembers'
import { usePermissions } from '@/api/application/hooks/usePermissions'
import { RoleLevel, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import { type Member } from '@/api/domain/identity/types/member.types'

const schema = yup.object({
  newRoleLevel: yup.number().oneOf([RoleLevel.MEMBER, RoleLevel.ADMIN], 'Invalid role').required('Role is required')
})

type FormValues = yup.InferType<typeof schema>

type Props = {
  row?: Member
  accountId?: string
  open?: boolean
  onClose?: () => void
}

export function ChangeRoleDialog({ row, accountId, open = false, onClose }: Props) {
  const changeRole = useChangeMemberRole(accountId ?? '')
  const permissions = usePermissions(accountId ?? '')

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { newRoleLevel: row?.role.level }
  })

  const { reset } = form

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" and
  // "Step 4: Form/Field error-display requires reading formState.isSubmitting"
  // — reused verbatim from the established template.
  const untypedForm = form as any
  void form.formState.errors

  if (!row || !accountId) return null

  const handleClose = () => {
    reset()
    onClose?.()
  }

  const onSubmit = (values: FormValues) => {
    changeRole.mutate(
      { userId: row.userId, data: { newRoleLevel: values.newRoleLevel as RoleLevel } },
      {
        onSuccess: () => {
          reset()
          onClose?.()
        }
      }
    )
  }

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  // Cannot assign a role >= own level — mirrors backend canPromoteTo exactly
  const assignableRoles = [
    { label: roleLevelName(RoleLevel.MEMBER), value: RoleLevel.MEMBER },
    { label: roleLevelName(RoleLevel.ADMIN), value: RoleLevel.ADMIN },
    { label: roleLevelName(RoleLevel.OWNER), value: RoleLevel.OWNER }
  ].filter(r => permissions.canPromoteTo(r.value))

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Change role</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <Typography variant='body2'>Changing role for {row.user?.fullName ?? row.userId}</Typography>

            <Select
              value={String(form.watch('newRoleLevel'))}
              onValueChange={value => form.setValue('newRoleLevel', Number(value) as RoleLevel, { shouldDirty: true })}
            >
              <Select.Trigger aria-label='New role' />
              <Select.Content>
                {assignableRoles.map(r => (
                  <Select.Item key={r.value} value={String(r.value)}>
                    {r.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <Dialog.Footer>
              <Button className='shrink-0' variant='secondary' onClick={handleClose} type='button'>
                Cancel
              </Button>
              <Button className='shrink-0' type='submit' loading={changeRole.isPending}>
                Save
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
