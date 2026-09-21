'use client'

import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Dialog, Form, TextField, toast } from '@vhyxui/react'
import { ApiError } from '@vhyx/api-kit'

import { useCreateAdmin } from '@/api/application/hooks/useAdminUsers'
import { createAdminSchema, toCreateAdminPayload, type CreateAdminFormValues } from './adminUserForms.schema'

type Props = {
  open: boolean
  onClose: () => void
}

// POST /admin/identity/users takes email, password, firstName, lastName and
// nothing else -- no role at creation time (CreateAdminUseCase / AdminUser.create
// take none, and a new admin is never a super admin), so a brand-new admin can
// log in but every ability-gated route answers 403 until a role is assigned
// separately. On success this therefore opens the new admin's detail page,
// where the role picker is. See internal-tools/admin-frontend/decision.md,
// 2026-09-21 ("Create Admin and Edit Profile").
export function CreateAdminDialog({ open, onClose }: Props) {
  const router = useRouter()
  const createAdmin = useCreateAdmin()

  const form = useForm<CreateAdminFormValues>({
    resolver: yupResolver(createAdminSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' }
  })

  const { reset, setError } = form

  // See views/auth/AdminLogin.tsx / CreateApiKeyDialog.tsx for why both lines
  // below are needed (VhyxUI's Form generic typing friction, and Field's error
  // display requiring formState.errors to be read).
  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  const onSubmit = (values: CreateAdminFormValues) => {
    createAdmin.mutate(toCreateAdminPayload(values), {
      onSuccess: created => {
        toast.success(`Created ${created.fullName}. Assign a role so they can do anything.`)
        reset()
        onClose()
        router.push(`/admin-users/${created.id}`)
      },
      onError: (err: any) => {
        // 409 = "Admin with this email already exists": belongs on the field.
        if (err instanceof ApiError && err.status === 409) {
          setError('email', { type: 'server', message: err.message })

          return
        }

        toast.danger(err?.message ?? 'Failed to create admin')
      }
    })
  }

  const handleFormSubmit = (data: any) => onSubmit(data as CreateAdminFormValues)

  const handleClose = () => {
    reset()
    createAdmin.reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Create admin</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <div className='grid grid-cols-2 gap-4'>
              <TextField label='First name' autoFocus {...form.register('firstName')} />
              <TextField label='Last name' {...form.register('lastName')} />
            </div>

            <TextField label='Email' type='email' placeholder='name@company.com' {...form.register('email')} />

            <TextField
              label='Password'
              type='password'
              autoComplete='new-password'
              placeholder='At least 8 characters'
              {...form.register('password')}
            />
            <TextField
              label='Confirm password'
              type='password'
              autoComplete='new-password'
              {...form.register('confirmPassword')}
            />

            <Alert variant='info'>
              There is no admin password reset yet, so make sure the password is right and tell them it. The new admin
              has no roles: assign one on the next screen or they can sign in but not do anything.
            </Alert>

            <Dialog.Footer>
              <Button className='shrink-0' variant='secondary' type='button' onClick={handleClose}>
                Cancel
              </Button>
              <Button className='shrink-0' type='submit' loading={loading || createAdmin.isPending}>
                Create admin
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
