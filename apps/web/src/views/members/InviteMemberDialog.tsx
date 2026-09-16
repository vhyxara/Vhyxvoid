'use client'
import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Button, Dialog, Form, Select, TextField } from '@vhyxui/react'

import { useInviteMember } from '@/api/application/hooks/useMembers'
import { RoleLevel, roleLevelName } from '@/api/domain/identity/enums/role.enum'
import type { Permissions } from '@/api/application/hooks/usePermissions'

// ── Schema ────────────────────────────────────────────────────────────────

const schema = yup.object({
  email: yup.string().email('Invalid email').required('Email is required'),
  roleLevel: yup.number().oneOf([RoleLevel.MEMBER, RoleLevel.ADMIN], 'Invalid role').required('Role is required')
})

type FormValues = yup.InferType<typeof schema>

// ── Component ─────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onClose: () => void
  accountId: string
  permissions: Permissions
}

export function InviteMemberDialog({ open, onClose, accountId, permissions }: Props) {
  const invite = useInviteMember(accountId)

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { email: '', roleLevel: RoleLevel.MEMBER }
  })

  const { reset } = form

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" and
  // "Step 4: Form/Field error-display requires reading formState.isSubmitting"
  // — reused verbatim from the established template.
  const untypedForm = form as any
  void form.formState.errors

  const onSubmit = (values: FormValues) => {
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

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  const handleClose = () => {
    reset()
    onClose()
  }

  // Only show roles the actor can actually assign (cannot assign >= own level)
  const assignableRoles = [
    { label: roleLevelName(RoleLevel.MEMBER), value: RoleLevel.MEMBER },
    { label: roleLevelName(RoleLevel.ADMIN), value: RoleLevel.ADMIN }
  ].filter(r => permissions.canPromoteTo(r.value))

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Invite member</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <TextField label='Email address' type='email' autoFocus {...form.register('email')} />

            <Select
              value={String(form.watch('roleLevel'))}
              onValueChange={value => form.setValue('roleLevel', Number(value) as RoleLevel, { shouldDirty: true })}
            >
              <Select.Trigger aria-label='Role' />
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
              <Button className='shrink-0' type='submit' loading={invite.isPending}>
                Send invite
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
