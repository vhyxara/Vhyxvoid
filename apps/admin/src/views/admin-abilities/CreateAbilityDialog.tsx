'use client'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Button, Dialog, Form, TextareaField, TextField, toast } from '@vhyxui/react'

import { useCreateAbility } from '@/api/application/hooks/useAdminAbilities'

// createAbilitySchema (admin.dto.ts): action + category required, description
// optional -- confirmed by reading it directly. Two required plain-text
// fields plus one optional textarea, no password/security complexity --
// same proportionate-to-build call as Create Role.
const schema = yup.object({
  action: yup.string().min(1, 'Action is required').required('Action is required'),
  category: yup.string().min(1, 'Category is required').required('Category is required'),
  description: yup.string().optional().default('')
})

type FormValues = yup.InferType<typeof schema>

type Props = {
  open: boolean
  onClose: () => void
}

export function CreateAbilityDialog({ open, onClose }: Props) {
  const createAbility = useCreateAbility()

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { action: '', category: '', description: '' }
  })

  const { reset } = form

  // See views/auth/AdminLogin.tsx / CreateRoleDialog.tsx for why both lines
  // below are needed (VhyxUI's Form generic typing friction, and Field's
  // error display requiring formState.errors to be read).
  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  const onSubmit = (values: FormValues) => {
    createAbility.mutate(
      { action: values.action, category: values.category, description: values.description || undefined },
      {
        onSuccess: () => {
          reset()
          onClose()
        },
        onError: (err: any) => {
          // A duplicate category+action pair rejects with a 409 ("Ability
          // already exists") -- confirmed by reading CreateAbilityUseCase
          // directly. Surfaced via the same real error message, not a
          // generic fallback, so the admin knows exactly why it failed.
          toast.danger(err?.message ?? 'Failed to create ability')
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
          <Dialog.Title>Create ability</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <TextField label='Action' autoFocus placeholder='e.g. billing.export' {...form.register('action')} />

            <TextField label='Category' placeholder='e.g. billing' {...form.register('category')} />

            <TextareaField
              label='Description (optional)'
              placeholder='What does this ability grant?'
              {...form.register('description')}
            />

            <Dialog.Footer>
              <Button className='shrink-0' variant='secondary' type='button' onClick={handleClose}>
                Cancel
              </Button>
              <Button className='shrink-0' type='submit' loading={loading || createAbility.isPending}>
                Create ability
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
