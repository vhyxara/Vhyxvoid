'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { Alert, Badge, Button, Card, Select, Spinner } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import Confirmation from '@/libs/components/Confirmation'
import {
  useAdminUserDetail,
  useAssignRoleToAdmin,
  useRevokeRoleFromAdmin
} from '@/api/application/hooks/useAdminUsers'
import { useAdminRolesList } from '@/api/application/hooks/useAdminRoles'
import { EditAdminProfileCard } from './EditAdminProfileCard'

function formatLastLogin(value: string | null): string {
  if (!value) return 'Never'

  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function AdminUserDetailView({ id }: { id: string }) {
  const router = useRouter()
  const { data: admin, isLoading, error } = useAdminUserDetail(id)
  const { data: roles } = useAdminRolesList()

  const assignRole = useAssignRoleToAdmin(id)
  const revokeRole = useRevokeRoleFromAdmin(id)

  const [selectedRoleId, setSelectedRoleId] = useState('')

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

  if (!admin) return null

  const assignedRoleIds = new Set(admin.roles.map(r => r.id))
  const assignableRoles = (roles ?? []).filter(r => !assignedRoleIds.has(r.id))

  // Real backend guard (AssignRoleToAdminUseCase/RevokeRoleFromAdminUseCase
  // both throw ConflictError for a super admin, confirmed via curl against
  // the live backend) -- super admins bypass every ability check anyway, so
  // role assignment is meaningless for them. Hidden here rather than shown
  // and left to fail.
  const canManageRoles = !admin.isSuperAdmin

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center gap-3'>
        <Button variant='ghost' size='sm' iconOnly aria-label='Back' icon={<i className='tabler-arrow-left' />} onClick={() => router.push('/admin-users')} />
        <Typography variant='h4'>{admin.fullName}</Typography>
      </div>

      <Card className='p-6 flex flex-col gap-3'>
        <div className='flex justify-between'>
          <Typography variant='body2'>Email</Typography>
          <Typography variant='body1'>{admin.email}</Typography>
        </div>
        <div className='flex justify-between'>
          <Typography variant='body2'>Role type</Typography>
          <Badge variant={admin.isSuperAdmin ? 'info' : 'default'} size='sm'>
            {admin.isSuperAdmin ? 'Super Admin' : 'Admin'}
          </Badge>
        </div>
        <div className='flex justify-between'>
          <Typography variant='body2'>Status</Typography>
          <Badge variant={admin.status ? 'success' : 'danger'} size='sm'>
            {admin.status ? 'Active' : 'Disabled'}
          </Badge>
        </div>
        <div className='flex justify-between'>
          <Typography variant='body2'>Last login</Typography>
          <Typography variant='body1'>{formatLastLogin(admin.lastLoginAt)}</Typography>
        </div>
      </Card>

      <EditAdminProfileCard admin={admin} />

      <Card className='p-6 flex flex-col gap-4'>
        <Typography variant='h6'>Roles</Typography>

        {admin.isSuperAdmin && (
          <Alert variant='info'>Super admins bypass every ability check and cannot be assigned or revoked roles.</Alert>
        )}

        <div className='flex gap-2 flex-wrap'>
          {admin.roles.length === 0 && <Typography variant='body2'>No roles assigned{canManageRoles ? ' — this admin can log in but every ability check will fail until a role is added.' : ''}</Typography>}
          {admin.roles.map(role => (
            <div key={role.id} className='flex items-center gap-1'>
              <Badge variant='default' size='sm'>
                {role.name}
              </Badge>
              {canManageRoles && (
                <Confirmation
                  icon='tabler-x'
                  buttonSize='xs'
                  title='Revoke role'
                  content={`Revoke the "${role.name}" role from ${admin.fullName}?`}
                  confirmButtonText='Revoke'
                  onConfirm={() => revokeRole.mutateAsync(role.id)}
                />
              )}
            </div>
          ))}
        </div>

        {canManageRoles && (
          <div className='flex items-end gap-2'>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId} placeholder='Add a role...'>
              <Select.Trigger aria-label='Add a role' style={{ minWidth: 220 }} />
              <Select.Content>
                {assignableRoles.map(role => (
                  <Select.Item key={role.id} value={role.id}>
                    {role.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            <Button
              size='sm'
              disabled={!selectedRoleId}
              loading={assignRole.isPending}
              onClick={() => {
                assignRole.mutate(selectedRoleId, { onSuccess: () => setSelectedRoleId('') })
              }}
            >
              Add role
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
