'use client'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Badge, SelectField, Text } from '@vhyxui/react'

import { usePlatformList } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { UserRow } from '@/api/platform/types'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

export function userStateBadge(u: { status: boolean; isEmailVerified: boolean; locked?: boolean; deletedAt: string | null }) {
  if (u.deletedAt) return <Badge variant='danger' size='sm'>Deleted</Badge>
  if (!u.status) return <Badge variant='danger' size='sm'>Disabled</Badge>
  if (u.locked) return <Badge variant='warning' size='sm'>Locked</Badge>
  if (!u.isEmailVerified) return <Badge variant='info' size='sm'>Unverified</Badge>

  return <Badge variant='success' size='sm'>Active</Badge>
}

export function UsersView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status'])
  const query = usePlatformList('users', platformService.users, params)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='Users' description='Everyone who has signed up. Open one to help them or act on their account.' />
      <ServerTable<UserRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Email, name or id' }}
        toolbar={
          <div style={{ minInlineSize: 160 }}>
            <SelectField
              name='status'
              label='State'
              size='sm'
              value={String(params.status ?? 'all')}
              onValueChange={v => set({ status: v === 'all' ? undefined : v })}
              options={[
                { value: 'all', label: 'All (not deleted)' },
                { value: 'active', label: 'Active' },
                { value: 'unverified', label: 'Unverified' },
                { value: 'locked', label: 'Locked' },
                { value: 'disabled', label: 'Disabled' },
                { value: 'deleted', label: 'Deleted' }
              ]}
            />
          </div>
        }
        emptyTitle='No users match'
        columns={[
          {
            key: 'email',
            header: 'User',
            cell: r => (
              <div className='flex flex-col'>
                <Link href={`/users/${r.id}`}>{r.email}</Link>
                <Text size='xs' tone='muted'>
                  {`${r.firstName} ${r.lastName}`.trim() || '—'}
                </Text>
              </div>
            )
          },
          { key: 'state', header: 'State', cell: r => userStateBadge(r) },
          { key: 'accounts', header: 'Workspaces', align: 'end' },
          { key: 'createdAt', header: 'Signed up', cell: r => formatDate(r.createdAt, false) }
        ]}
      />
    </div>
  )
}
