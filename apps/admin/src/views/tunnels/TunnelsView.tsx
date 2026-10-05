'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Table, Tabs, Text, toast } from '@vhyxui/react'

import { platformKeys, usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { LiveAgent, TunnelSessionRow } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, timeAgo } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

function LiveTunnels() {
  const live = useQuery({ queryKey: platformKeys.area('tunnels-live'), queryFn: () => platformService.liveTunnels(), refetchInterval: 15_000 })
  const disconnect = usePlatformMutation(['tunnels-live', 'tunnels'], (v: { agentId: string; reason: string }) => platformService.disconnectAgent(v.agentId, v.reason))
  const [target, setTarget] = useState<LiveAgent | null>(null)

  if (live.data && !live.data.available) {
    return (
      <Alert variant='warning' title='Live data unavailable'>
        {live.data.message}
      </Alert>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <Text size='sm' tone='muted'>
        {live.data ? `${live.data.agents.length} agent(s) connected · refreshes every 15 s` : 'Loading…'}
      </Text>
      <div style={{ overflowX: 'auto' }}>
        <Table
          density='compact'
          data={(live.data?.agents ?? []) as any}
          rowKey={(r: any) => r.agentId}
          emptyState={<Text tone='muted'>No agents connected right now.</Text>}
          columns={[
            { key: 'url', header: 'Tunnel', cell: (r: any) => (r.url ? <a href={r.url} target='_blank' rel='noreferrer'>{r.url.replace(/^https:\/\//, '')}</a> : r.label) },
            { key: 'account', header: 'Account', cell: (r: any) => (r.account ? <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> : r.accountId) },
            { key: 'agentVersion', header: 'Agent', cell: (r: any) => <Badge variant='outline' size='sm'>{r.agentVersion ?? '?'}</Badge> },
            { key: 'ip', header: 'IP' },
            { key: 'connectedAt', header: 'Connected', cell: (r: any) => timeAgo(r.connectedAt) },
            { key: 'missedPings', header: 'Missed pings', align: 'end' },
            {
              key: 'x',
              header: '',
              align: 'end',
              cell: (r: any) => (
                <Button size='xs' variant='ghost' onClick={() => setTarget(r)}>
                  Disconnect
                </Button>
              )
            }
          ]}
        />
      </div>
      {target && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setTarget(null)}
          title={`Disconnect ${target.label}?`}
          description='The agent stops and does not reconnect by itself. To keep an account off, suspend it or revoke the key instead.'
          confirmLabel='Disconnect'
          destructive
          onConfirm={reason => disconnect.mutateAsync({ agentId: target.agentId, reason }).then(() => toast.success('Agent disconnected'))}
        />
      )}
    </div>
  )
}

function SessionHistory() {
  const { params, set, searchInput, setSearchInput } = useListState(['status', 'accountId'])
  const query = usePlatformList('tunnels', platformService.tunnelSessions, params)

  return (
    <ServerTable<TunnelSessionRow>
      query={query}
      page={Number(params.page)}
      onPageChange={p => set({ page: p }, false)}
      search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Label or agent id' }}
      columns={[
        { key: 'label', header: 'Label' },
        { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
        { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
        { key: 'connectedAt', header: 'Connected', cell: r => formatDate(r.connectedAt) },
        { key: 'disconnectedAt', header: 'Disconnected', cell: r => formatDate(r.disconnectedAt) },
        { key: 'agent', header: 'Agent', cell: r => r.metadata?.agentVersion ?? '—' },
        { key: 'key', header: 'Key', cell: r => <code>{r.apiKey.keyId}</code> }
      ]}
    />
  )
}

export function TunnelsView() {
  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='Tunnels' description='Agents connected to the hub right now, and connection history.' />
      <Tabs defaultValue='live' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='live'>Live</Tabs.Trigger>
          <Tabs.Trigger value='history'>History</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value='live'>
          <LiveTunnels />
        </Tabs.Content>
        <Tabs.Content value='history'>
          <SessionHistory />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
