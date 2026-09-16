'use client'
import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Dialog, Form, TextField } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useCreateOrg } from '@/api/application/hooks/useOrg'

import { type CreateOrgFormValues, createOrgSchema } from '@/api/domain/identity/schemas/createOrg.schema'

type Props = {
  open: boolean
  onClose: () => void
}

export function CreateOrgDialog({ open, onClose }: Props) {
  const createOrg = useCreateOrg()

  const form = useForm<CreateOrgFormValues>({
    resolver: yupResolver(createOrgSchema),
    defaultValues: { name: '' }
  })

  const { reset } = form

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" and
  // "Step 4: Form/Field error-display requires reading formState.isSubmitting"
  // — reused verbatim from the established template.
  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

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

  const handleFormSubmit = (data: any) => onSubmit(data as CreateOrgFormValues)

  const handleClose = () => {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()} size='sm'>
      {/* Dialog.Portal gates rendering on open state — see decision.md,
          2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Create organization</Dialog.Title>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
            <Typography variant='body2' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
              Organizations let you collaborate with a team under shared billing and role-based access.
            </Typography>

            <TextField
              label='Organization name'
              autoFocus
              placeholder='e.g. Acme Corp'
              {...form.register('name')}
            />

            <Dialog.Footer>
              <Button variant='secondary' onClick={handleClose} type='button'>
                Cancel
              </Button>
              <Button type='submit' loading={loading || createOrg.isPending}>
                Create
              </Button>
            </Dialog.Footer>
          </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
