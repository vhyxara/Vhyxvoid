'use client'

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Alert, Badge, Button, Card, Select, Spinner, TextareaField, TextField, Form, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import Confirmation from '@/libs/components/Confirmation'
import {
  useAdminRoleDetail,
  useAssignAbilityToRole,
  useRevokeAbilityFromRole,
  useRoleAbilities,
  useUpdateRole
} from '@/api/application/hooks/useAdminRoles'
import { useAdminAbilitiesList } from '@/api/application/hooks/useAdminAbilities'

const schema = yup.object({
  name: yup.string().min(1, 'Name is required').required('Name is required'),
  description: yup.string().optional().default('')
})

type FormValues = yup.InferType<typeof schema>

export function AdminRoleDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { data: role, isLoading, error } = useAdminRoleDetail(id)
  const { data: roleAbilities } = useRoleAbilities(id)
  const { data: allAbilities } = useAdminAbilitiesList()

  const updateRole = useUpdateRole(id)
  const assignAbility = useAssignAbilityToRole(id)
  const revokeAbility = useRevokeAbilityFromRole(id)

  const [selectedAbilityId, setSelectedAbilityId] = useState('')

  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: { name: '', description: '' }
  })

  const { reset } = form

  useEffect(() => {
    if (role) reset({ name: role.name, description: role.description ?? '' })
  }, [role, reset])

  const untypedForm = form as any
  const loading = form.formState.isSubmitting
  void form.formState.errors

  if (isLoading) {
    return (
      <div className='flex items-center justify-center p-12'>
        <Spinner size='lg' />
      </div>
    )
  }

  if (error) {
    return <Alert variant='danger'>{(error as Error).message}</Alert>
  }

  if (!role) return null

  const assignedAbilityIds = new Set((roleAbilities ?? []).map(a => a.id))
  const assignableAbilities = (allAbilities ?? []).filter(a => !assignedAbilityIds.has(a.id))

  const onSubmit = (values: FormValues) => {
    updateRole.mutate(
      { name: values.name, description: values.description || undefined },
      {
        onError: (err: any) => {
          toast.danger(err?.message ?? 'Failed to update role')
        }
      }
    )
  }

  const handleFormSubmit = (data: any) => onSubmit(data as FormValues)

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center gap-3'>
        <Button variant='ghost' size='sm' iconOnly aria-label='Back' icon={<i className='tabler-arrow-left' />} onClick={() => router.push('/roles')} />
        <Typography variant='h4'>{role.name}</Typography>
        <Badge variant={role.isSystem ? 'info' : 'default'} size='sm'>
          {role.isSystem ? 'System' : 'Custom'}
        </Badge>
      </div>

      <Card className='p-6 flex flex-col gap-4'>
        <Typography variant='h6'>Details</Typography>

        {/* AdminRole.entities.ts's update() calls validateNotSystem(),
            rejecting with a real 409 CONFLICT ("System roles cannot be
            modified") -- confirmed via curl against the live backend.
            Disabled here rather than letting a user hit that rejection. */}
        {role.isSystem && (
          <Alert variant='info'>
            System roles cannot be renamed or redescribed. This is enforced by the backend, not just this screen.
          </Alert>
        )}

        <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-4'>
          <TextField label='Name' disabled={role.isSystem} {...form.register('name')} />
          <TextareaField label='Description' disabled={role.isSystem} {...form.register('description')} />

          {!role.isSystem && (
            <Button type='submit' size='sm' style={{ alignSelf: 'flex-start' }} loading={loading || updateRole.isPending}>
              Save changes
            </Button>
          )}
        </Form>
      </Card>

      <Card className='p-6 flex flex-col gap-4'>
        <Typography variant='h6'>Abilities</Typography>

        {/* AssignAbilityToRoleUseCase/RevokeAbilityFromRoleUseCase have NO
            isSystem guard (confirmed by reading both use cases directly and
            empirically via curl against a live system role) -- unlike the
            edit form above, this stays enabled for system roles. */}
        {role.isSystem && (
          <Alert variant='info'>
            Unlike name/description, ability assignment has no system-role restriction on the backend -- abilities can
            be added or removed here even for a system role.
          </Alert>
        )}

        <div className='flex gap-2 flex-wrap'>
          {(roleAbilities ?? []).length === 0 && (
            <Typography variant='body2'>No abilities assigned — every ability check for this role will fail.</Typography>
          )}
          {(roleAbilities ?? []).map(ability => (
            <div key={ability.id} className='flex items-center gap-1'>
              <Badge variant='default' size='sm'>
                {ability.category}.{ability.action}
              </Badge>
              <Confirmation
                icon='tabler-x'
                buttonSize='xs'
                title='Revoke ability'
                content={`Revoke "${ability.category}.${ability.action}" from ${role.name}?`}
                confirmButtonText='Revoke'
                onConfirm={() => revokeAbility.mutateAsync(ability.id)}
              />
            </div>
          ))}
        </div>

        <div className='flex items-end gap-2'>
          <Select value={selectedAbilityId} onValueChange={setSelectedAbilityId} placeholder='Add an ability...'>
            <Select.Trigger aria-label='Add an ability' style={{ minWidth: 260 }} />
            <Select.Content>
              {assignableAbilities.map(ability => (
                <Select.Item key={ability.id} value={ability.id}>
                  {ability.category}.{ability.action}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          <Button
            size='sm'
            disabled={!selectedAbilityId}
            loading={assignAbility.isPending}
            onClick={() => {
              assignAbility.mutate(selectedAbilityId, { onSuccess: () => setSelectedAbilityId('') })
            }}
          >
            Add ability
          </Button>
        </div>
      </Card>
    </div>
  )
}
