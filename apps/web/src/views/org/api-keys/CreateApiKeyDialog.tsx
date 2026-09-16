'use client'
import { useState } from 'react'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Alert, Badge, Button, Dialog, Form, Select, TextField } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useCreateApiKey } from '@/api/application/hooks/useApiKeys'
import type { ApiScope, ApiKey, ApiKeyEnvironment } from '@/api/domain/key-management/types/api-key.types'

// Available scopes — extend as your backend adds more
const AVAILABLE_SCOPES: { value: ApiScope; label: string; description: string }[] = [
  { value: 'tunnel:connect', label: 'Tunnel Connect', description: 'Allow tunnel connections' },
  { value: 'tunnel:read', label: 'Tunnel Read', description: 'Read tunnel data' },
  { value: 'metrics:read', label: 'Metrics Read', description: 'Read usage metrics' }
]

const schema = yup.object({
  name: yup.string().min(2).max(64).required('Name is required'),
  description: yup.string().max(256).optional().default(''),
  environment: yup.string().oneOf(['DEV', 'PROD']).required('Environment is required'),
  expiresAt: yup.string().optional().default('')
})

type FormValues = yup.InferType<typeof schema>

type Props = {
  open: boolean
  onClose: () => void
  accountId: string
  onCreated: (key: ApiKey, secret: string) => void
}

export function CreateApiKeyDialog({ open, onClose, accountId, onCreated }: Props) {
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>(['tunnel:connect'])
  const createKey = useCreateApiKey(accountId)

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: '', description: '', environment: 'DEV', expiresAt: '' }
  })

  const { reset } = form

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" and
  // "Step 4: Form/Field error-display requires reading formState.isSubmitting"
  // — reused verbatim from the established template.
  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  const toggleScope = (scope: ApiScope) => {
    setSelectedScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]))
  }

  const onSubmit = (values: FormValues) => {
    if (selectedScopes.length === 0) return

    createKey.mutate(
      {
        name: values.name,
        description: values.description || undefined,
        environment: values.environment as ApiKeyEnvironment,
        scopes: selectedScopes,
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined
      },
      {
        onSuccess: res => {
          reset()
          setSelectedScopes(['tunnel:connect'])
          onCreated(res.key, res.secret)
        }
      }
    )
  }

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  const handleClose = () => {
    reset()
    setSelectedScopes(['tunnel:connect'])
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && handleClose()}>
      {/* Dialog.Portal is what actually gates rendering on `open` — see
          decision.md, 2026-09-10/11, "Step 5b: Dialog.Portal omission". */}
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
        <Dialog.Title>Create API key</Dialog.Title>

        <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
          <TextField label='Key name' autoFocus placeholder='e.g. Production tunnel agent' {...form.register('name')} />

          <TextField
            label='Description (optional)'
            placeholder='What is this key used for?'
            {...form.register('description')}
          />

          <Select
            value={form.watch('environment')}
            onValueChange={value => form.setValue('environment', value as ApiKeyEnvironment, { shouldDirty: true })}
          >
            <Select.Trigger aria-label='Environment' />
            <Select.Content>
              <Select.Item value='DEV'>Development</Select.Item>
              <Select.Item value='PROD'>Production</Select.Item>
            </Select.Content>
          </Select>

          {/* Scope selector — a hand-built Badge-array toggle, not a
              multi-select Autocomplete. Confirmed no VhyxUI multi-select
              component exists for this; reusing the same architecture the
              original MUI version used (local useState, not RHF-driven —
              this isn't a native form field), just restyled onto Badge. */}
          <div>
            <Typography variant='subtitle2'>Scopes</Typography>
            <Typography variant='caption' className='mb-2' style={{ display: 'block' }}>
              Select the permissions this key will have.
            </Typography>
            <div className='flex flex-wrap gap-2'>
              {AVAILABLE_SCOPES.map(s => {
                const selected = selectedScopes.includes(s.value)

                return (
                  <button
                    key={s.value}
                    type='button'
                    onClick={() => toggleScope(s.value)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    {/* Badge has no accent/primary variant (only default/
                        success/warning/danger/info/outline) — the selected
                        state needs the brand accent color, which Button's
                        'primary' variant has but Badge doesn't, so it's
                        applied as a targeted inline override here rather
                        than picking a semantically-wrong variant. */}
                    <Badge
                      variant={selected ? 'default' : 'outline'}
                      style={selected ? { backgroundColor: 'var(--vhyx-color-accent)', color: '#fff' } : undefined}
                    >
                      {s.label}
                    </Badge>
                  </button>
                )
              })}
            </div>
            {selectedScopes.length === 0 && (
              <Typography variant='caption' className='mt-1' style={{ display: 'block', color: 'var(--vhyx-color-danger)' }}>
                Select at least one scope
              </Typography>
            )}
          </div>

          <TextField
            label='Expiry date (optional)'
            type='date'
            hint='Leave empty for a non-expiring key'
            {...form.register('expiresAt')}
          />

          <Alert variant='info' icon={<i className='tabler-info-circle' />}>
            The secret key is only shown once after creation. Store it securely.
          </Alert>

          <Dialog.Footer>
            <Button className='shrink-0' variant='secondary' onClick={handleClose} type='button'>
              Cancel
            </Button>
            <Button
              className='shrink-0'
              type='submit'
              loading={loading || createKey.isPending}
              disabled={selectedScopes.length === 0}
            >
              Create key
            </Button>
          </Dialog.Footer>
        </Form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
