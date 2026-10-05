'use client'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Badge, SelectField, Text } from '@vhyxui/react'

import { usePlatformList } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { AccountRow } from '@/api/platform/types'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

const FILTERS = ['status', 'type', 'plan']

export function AccountsView() {
  const { params, set, searchInput, setSearchInput } = useListState(FILTERS)
  const query = usePlatformList('accounts', platformService.accounts, params)

  const filter = (key: string, label: string, options: string[]) => (
    <div style={{ minInlineSize: 150 }}>
      <SelectField name={String(label)}
        label={label}
        size='sm'
        value={String(params[key] ?? 'all')}
        onValueChange={v => set({ [key]: v === 'all' ? undefined : v })}
        options={[{ value: 'all', label: `All` }, ...options.map(o => ({ value: o, label: o.replace(/_/g, ' ').toLowerCase() }))]}
      />
    </div>
  )

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='Accounts' description='Personal workspaces and organizations. Open one to manage it.' />
      <ServerTable<AccountRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Name, slug, id, member email or Stripe customer' }}
        toolbar={
          <>
            {filter('status', 'Status', ['ACTIVE', 'PAST_DUE', 'RESTRICTED', 'SUSPENDED', 'CANCELED', 'DELETED'])}
            {filter('type', 'Type', ['PERSONAL', 'ORGANIZATION'])}
            {filter('plan', 'Plan', ['FREE', 'PRO', 'ENTERPRISE'])}
          </>
        }
        emptyTitle='No accounts match'
        columns={[
          {
            key: 'name',
            header: 'Account',
            cell: r => (
              <div className='flex flex-col'>
                <Link href={`/accounts/${r.id}`}>{r.name}</Link>
                <Text size='xs' tone='muted'>
                  {r.slug ?? '—'}
                </Text>
              </div>
            )
          },
          { key: 'type', header: 'Type', cell: r => <Badge variant='outline' size='sm'>{r.type === 'PERSONAL' ? 'Personal' : 'Organization'}</Badge> },
          { key: 'plan', header: 'Plan', cell: r => (r.subscription ? `${r.subscription.plan}` : 'FREE') },
          { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
          { key: 'members', header: 'Members', align: 'end' },
          { key: 'apiKeys', header: 'Keys', align: 'end' },
          { key: 'owner', header: 'Created by', cell: r => r.createdBy?.email },
          { key: 'createdAt', header: 'Created', cell: r => formatDate(r.createdAt, false) }
        ]}
      />
    </div>
  )
}
