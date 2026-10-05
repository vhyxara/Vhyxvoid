'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PageHeader } from '@vhyxui/blocks'
import { Badge, Button, Switch, Tabs, Text, toast } from '@vhyxui/react'

import { usePlatformList } from '@/api/platform/hooks'
import { downloadAdminAuditCsv, platformService } from '@/api/platform/service'
import type { ActivityRow, RequestRow, SecurityEvent } from '@/api/platform/types'
import { ServerTable } from '@/components/ui/ServerTable'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

function SecurityEvents() {
  const { params, set, searchInput, setSearchInput } = useListState(['type', 'accountId'])
  const query = usePlatformList('logs-security', platformService.securityEvents, params)
  const byType: Array<{ type: string; count: number }> = query.data?.extra?.byType ?? []

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap gap-2'>
        {byType.map(t => (
          <Button key={t.type} size='xs' variant={params.type === t.type ? 'primary' : 'outline'} onClick={() => set({ type: params.type === t.type ? undefined : t.type })}>
            {t.type.replace(/_/g, ' ').toLowerCase()} · {t.count}
          </Button>
        ))}
      </div>
      <ServerTable<SecurityEvent>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'IP address or reason' }}
        emptyTitle='No security events'
        emptyDescription='Bad signatures, replays, rate limits and scope violations on API keys show up here.'
        columns={[
          { key: 'createdAt', header: 'When', cell: r => formatDate(r.createdAt) },
          { key: 'type', header: 'Type', cell: r => <Badge variant='warning' size='sm'>{r.type}</Badge> },
          { key: 'account', header: 'Account', cell: r => (r.account ? <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> : '—') },
          { key: 'key', header: 'Key', cell: r => (r.apiKey ? <code>{r.apiKey.keyId}</code> : '—') },
          { key: 'ip', header: 'IP' },
          { key: 'reason', header: 'Reason' }
        ]}
      />
    </div>
  )
}

function Activity() {
  const { params, set, searchInput, setSearchInput } = useListState(['action', 'accountId', 'userId'])
  const query = usePlatformList('logs-activity', platformService.activity, params)

  return (
    <ServerTable<ActivityRow>
      query={query}
      page={Number(params.page)}
      onPageChange={p => set({ page: p }, false)}
      search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Action, resource id or IP' }}
      emptyTitle='No activity'
      columns={[
        { key: 'createdAt', header: 'When', cell: r => formatDate(r.createdAt) },
        { key: 'action', header: 'Action', cell: r => <code>{r.action}</code> },
        { key: 'user', header: 'By', cell: r => (r.user ? <Link href={`/users/${r.user.id}`}>{r.user.email}</Link> : '—') },
        { key: 'account', header: 'Account', cell: r => (r.account ? <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> : '—') },
        { key: 'resource', header: 'Resource', cell: r => `${r.resourceType}${r.resourceId ? ` ${r.resourceId.slice(0, 8)}` : ''}` },
        { key: 'ipAddress', header: 'IP' }
      ]}
    />
  )
}

function Requests() {
  const { params, set, searchInput, setSearchInput } = useListState(['accountId', 'failed'])
  const query = usePlatformList('logs-requests', platformService.requests, params)

  return (
    <ServerTable<RequestRow>
      query={query}
      page={Number(params.page)}
      onPageChange={p => set({ page: p }, false)}
      search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Path contains…' }}
      toolbar={
        <label className='flex items-center gap-2'>
          <Switch checked={params.failed === 'true'} onCheckedChange={c => set({ failed: c ? 'true' : undefined })} aria-label='Failures only' />
          <Text size='sm'>Failures only</Text>
        </label>
      }
      emptyTitle='No requests recorded'
      emptyDescription='SDK requests through the hub are recorded here.'
      columns={[
        { key: 'createdAt', header: 'When', cell: r => formatDate(r.createdAt) },
        { key: 'method', header: 'Method', cell: r => <code>{r.method}</code> },
        { key: 'path', header: 'Path', cell: r => <code style={{ overflowWrap: 'anywhere' }}>{r.path}</code> },
        { key: 'status', header: 'Status', cell: r => (r.status ? <Badge variant={r.status >= 500 ? 'danger' : r.status >= 400 ? 'warning' : 'success'} size='sm'>{r.status}</Badge> : <Badge variant='danger' size='sm'>{r.errorCode ?? 'no response'}</Badge>) },
        { key: 'durationMs', header: 'Time', align: 'end', cell: r => (r.durationMs !== null ? `${r.durationMs} ms` : '—') },
        { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> }
      ]}
    />
  )
}

export function LogsView() {
  const [exporting, setExporting] = useState(false)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Logs'
        description='Security events on API keys, what customers did in their accounts, and tunnelled requests.'
        actions={[
          <Button
            key='csv'
            variant='outline'
            loading={exporting}
            onClick={() => {
              setExporting(true)
              downloadAdminAuditCsv()
                .catch(e => toast.danger(e.message))
                .finally(() => setExporting(false))
            }}
          >
            Export admin audit (CSV)
          </Button>
        ]}
      />
      <Tabs defaultValue='security' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='security'>Security events</Tabs.Trigger>
          <Tabs.Trigger value='activity'>Customer activity</Tabs.Trigger>
          <Tabs.Trigger value='requests'>Requests</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value='security'>
          <SecurityEvents />
        </Tabs.Content>
        <Tabs.Content value='activity'>
          <Activity />
        </Tabs.Content>
        <Tabs.Content value='requests'>
          <Requests />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
