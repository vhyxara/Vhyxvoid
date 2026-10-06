'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Badge, Button, SelectField, Text, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { CustomDomainRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate, timeAgo } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

const STATUS: Record<CustomDomainRow['status'], { label: string; variant: 'success' | 'warning' | 'info' }> = {
  ACTIVE: { label: 'active', variant: 'success' },
  DNS_NOT_POINTING: { label: 'verified, DNS not pointing', variant: 'warning' },
  PENDING_VERIFICATION: { label: 'pending', variant: 'info' }
}

export function CustomDomainsView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status'])
  const query = usePlatformList('domains', platformService.customDomains, params)
  const remove = usePlatformMutation(['domains'], (v: { id: string; reason: string }) => platformService.removeCustomDomain(v.id, v.reason))
  const [target, setTarget] = useState<CustomDomainRow | null>(null)
  const [checking, setChecking] = useState(false)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Custom domains'
        description='Customers’ own hostnames. The edge only issues certificates for verified ones. Removing a domain stops it from routing at once.'
        actions={[
          <Button
            key='run'
            variant='outline'
            loading={checking}
            onClick={() => {
              setChecking(true)
              platformService
                .runJob('domains')
                .then(r => toast.success(`Checked DNS (${JSON.stringify(r.result)})`))
                .catch(e => toast.danger(e.message))
                .finally(() => setChecking(false))
            }}
          >
            Check DNS now
          </Button>
        ]}
      />
      <ServerTable<CustomDomainRow>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Hostname' }}
        toolbar={
          <div style={{ minInlineSize: 140 }}>
            <SelectField
              name='status'
              label='Status'
              size='sm'
              value={String(params.status ?? 'all')}
              onValueChange={v => set({ status: v === 'all' ? undefined : v })}
              options={[{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'pending', label: 'Pending' }]}
            />
          </div>
        }
        emptyTitle='No custom domains'
        columns={[
          { key: 'hostname', header: 'Hostname', cell: r => <code>{r.hostname}</code> },
          { key: 'status', header: 'Status', cell: r => <Badge size='sm' variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge> },
          { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
          { key: 'label', header: 'Tunnel', cell: r => <code>{r.label}</code> },
          { key: 'lastCheckedAt', header: 'DNS checked', cell: r => (r.lastError ? <Text size='xs' tone='danger'>{r.lastError}</Text> : timeAgo(r.lastCheckedAt)) },
          { key: 'createdAt', header: 'Added', cell: r => formatDate(r.createdAt, false) },
          {
            key: 'x',
            header: '',
            align: 'end',
            cell: r => (
              <Button size='xs' variant='ghost' onClick={() => setTarget(r)}>
                Remove
              </Button>
            )
          }
        ]}
      />
      {target && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setTarget(null)}
          title={`Remove ${target.hostname}?`}
          description={`It stops serving ${target.account.name}'s tunnel "${target.label}" immediately. The customer can add it again.`}
          confirmLabel='Remove domain'
          destructive
          onConfirm={reason => remove.mutateAsync({ id: target.id, reason }).then(() => toast.success('Domain removed'))}
        />
      )}
    </div>
  )
}
