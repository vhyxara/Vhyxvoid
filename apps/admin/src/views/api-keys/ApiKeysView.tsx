'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Badge, Button, SelectField, Text, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { ApiKeyRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, timeAgo } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

export function ApiKeysView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status', 'environment', 'accountId'])
  const query = usePlatformList('apikeys', platformService.apiKeys, params)
  const revoke = usePlatformMutation(['apikeys', 'accounts'], (v: { id: string; reason: string }) => platformService.revokeApiKey(v.id, v.reason))
  const [target, setTarget] = useState<ApiKeyRow | null>(null)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='API keys' description='Every key across every account. Revoking one disconnects its agents within a minute.' />
      <ServerTable<ApiKeyRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Key id or name' }}
        toolbar={
          <>
            <div style={{ minInlineSize: 140 }}>
              <SelectField
                name='status'
                label='Status'
                size='sm'
                value={String(params.status ?? 'all')}
                onValueChange={v => set({ status: v === 'all' ? undefined : v })}
                options={[{ value: 'all', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'REVOKED', label: 'Revoked' }, { value: 'EXPIRED', label: 'Expired' }]}
              />
            </div>
            <div style={{ minInlineSize: 140 }}>
              <SelectField
                name='environment'
                label='Environment'
                size='sm'
                value={String(params.environment ?? 'all')}
                onValueChange={v => set({ environment: v === 'all' ? undefined : v })}
                options={[{ value: 'all', label: 'All' }, { value: 'DEV', label: 'DEV' }, { value: 'PROD', label: 'PROD' }]}
              />
            </div>
          </>
        }
        emptyTitle='No keys match'
        columns={[
          {
            key: 'name',
            header: 'Key',
            cell: r => (
              <div className='flex flex-col'>
                <span>{r.name}</span>
                <Text size='xs' tone='muted'>
                  <code>{r.keyId}</code>
                </Text>
              </div>
            )
          },
          { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
          { key: 'environment', header: 'Env', cell: r => <Badge variant='outline' size='sm'>{r.environment}</Badge> },
          { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
          { key: 'scopes', header: 'Scopes', cell: r => <Text size='xs'>{r.scopes.join(', ')}</Text> },
          { key: 'lastUsedAt', header: 'Last used', cell: r => timeAgo(r.lastUsedAt) },
          { key: 'createdAt', header: 'Created', cell: r => formatDate(r.createdAt, false) },
          {
            key: 'x',
            header: '',
            align: 'end',
            cell: r =>
              r.status === 'ACTIVE' ? (
                <Button size='xs' variant='ghost' onClick={() => setTarget(r)}>
                  Revoke
                </Button>
              ) : null
          }
        ]}
      />
      {target && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setTarget(null)}
          title={`Revoke "${target.name}"?`}
          description={`${target.keyId} in ${target.account.name}. Agents using it are disconnected within a minute.`}
          confirmLabel='Revoke key'
          destructive
          onConfirm={reason => revoke.mutateAsync({ id: target.id, reason }).then(() => toast.success('Key revoked'))}
        />
      )}
    </div>
  )
}
