'use client'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Button, Dialog, Form, TextareaField, TextField, toast } from '@vhyxui/react'

import { useCreateRole } from '@/api/application/hooks/useAdminRoles'

// createRoleSchema (admin.dto.ts): name required, description optional --
// confirmed by reading it directly. Two plain fields, no password/security
// complexity the way Create Admin has -- proportionate to build this
// session rather than deferring it the way Create Admin was.
const schema = yup.object({
  name: yup.string().min(1, 'Name is required').required('Name is required'),
  description: yup.string().optional().default('')
})

type FormValues = yup.InferType<typeof schema>

type Props = {
  open: boolean
  onClose: () => void
}

export function CreateRoleDialog({ open, onClose }: Props) {
  const createRole = useCreateRole()

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: '', description: '' }
  })

  const { reset } = form

  // See views/auth/AdminLogin.tsx / CreateApiKeyDialog.tsx for why both
  // lines below are needed (VhyxUI's Form generic typing friction, and
  // Field's error display requiring formState.errors to be read).
  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  const onSubmit = (values: FormValues) => {
    createRole.mutate(
      { name: values.name, description: values.description || undefined },
      {
        onSuccess: () => {
          reset()
          onClose()
        },
        onError: (err: any) => {
          toast.danger(err?.message ?? 'Failed to create role')
        }
      }
    )
  }

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Create role</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <TextField label='Name' autoFocus placeholder='e.g. Support Agent' {...form.register('name')} />

            <TextareaField
              label='Description (optional)'
              placeholder='What is this role for?'
              {...form.register('description')}
            />

            <Dialog.Footer>
              <Button className='shrink-0' variant='secondary' type='button' onClick={handleClose}>
                Cancel
              </Button>
              <Button className='shrink-0' type='submit' loading={loading || createRole.isPending}>
                Create role
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
