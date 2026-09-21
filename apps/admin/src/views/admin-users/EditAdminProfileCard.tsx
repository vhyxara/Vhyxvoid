'use client'

import { useEffect } from 'react'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Card, Form, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useUpdateAdmin } from '@/api/application/hooks/useAdminUsers'
import type { AdminUserDetail } from '@/api/domain/admin-users/admin-user.types'
import {
  editAdminProfileSchema,
  toUpdateProfilePayload,
  type EditAdminProfileFormValues
} from './adminUserForms.schema'

// "Edit profile" is PUT /admin/identity/users/:id (ability admin.update): it edits
// firstName and lastName of ANY admin by id, the signed-in admin included --
// there is no separate "my profile" endpoint. Email and password are not
// editable anywhere in apps/api (updateAdminSchema has neither and the route
// silently ignores them), so this form has no such fields and says so.
export function EditAdminProfileCard({ admin }: { admin: AdminUserDetail }) {
  const updateAdmin = useUpdateAdmin(admin.id)

  const form = useForm<EditAdminProfileFormValues>({
    resolver: yupResolver(editAdminProfileSchema),
    defaultValues: { firstName: admin.firstName, lastName: admin.lastName }
  })

  const { reset } = form

  // Re-seed when the record itself changes (a save refetches the detail).
  useEffect(() => {
    reset({ firstName: admin.firstName, lastName: admin.lastName })
  }, [admin.firstName, admin.lastName, reset])

  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  const onSubmit = (values: EditAdminProfileFormValues) => {
    updateAdmin.mutate(toUpdateProfilePayload(values), {
      onSuccess: () => toast.success('Profile updated'),
      onError: (err: any) => toast.danger(err?.message ?? 'Failed to update profile')
    })
  }

  const handleFormSubmit = (data: any) => onSubmit(data as EditAdminProfileFormValues)

  return (
    <Card className='p-6 flex flex-col gap-4'>
      <Typography variant='h6'>Edit profile</Typography>

      <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
        <div className='grid grid-cols-2 gap-4'>
          <TextField label='First name' {...form.register('firstName')} />
          <TextField label='Last name' {...form.register('lastName')} />
        </div>

        <Typography variant='caption'>
          Only the name can be edited. An admin's email and password can't be changed from here, and the API has no
          endpoint for either.
        </Typography>

        <Button
          type='submit'
          size='sm'
          style={{ alignSelf: 'flex-start' }}
          disabled={!form.formState.isDirty}
          loading={loading || updateAdmin.isPending}
        >
          Save changes
        </Button>
      </Form>
    </Card>
  )
}
