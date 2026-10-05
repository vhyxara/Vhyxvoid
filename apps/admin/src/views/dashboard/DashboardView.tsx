'use client'

import { useState } from 'react'

import Link from 'next/link'

import { PageHeader, StatCard } from '@vhyxui/blocks'
import { Alert, Grid, SelectField, Text } from '@vhyxui/react'

import { useOverview } from '@/api/platform/hooks'
import { fillDays, formatMoney, formatNumber } from '@/components/ui/format'
import { MiniBars } from '@/components/ui/MiniBars'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'

export function DashboardView() {
  const [days, setDays] = useState(30)
  const { data, isLoading, error } = useOverview(days)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Dashboard'
        description='How the product is doing right now.'
        actions={[
          <div key='range' style={{ minInlineSize: 160 }}>
            <SelectField name='period'
              label='Period'
              value={String(days)}
              onValueChange={v => setDays(Number(v))}
              options={[
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' }
              ]}
              size='sm'
            />
          </div>
        ]}
      />

      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}

      <Grid minChildWidth='13rem' gap={4}>
        <StatCard label='Users' value={formatNumber(data?.users.total)} hint={data ? `+${formatNumber(data.users.new)} in ${days} days` : undefined} loading={isLoading} />
        <StatCard label='Accounts' value={formatNumber(data?.accounts.total)} hint={data ? `${formatNumber(data.accounts.byStatus.PAST_DUE ?? 0)} past due` : undefined} loading={isLoading} />
        <StatCard label='Paying subscriptions' value={formatNumber(data?.subscriptions.active)} loading={isLoading} />
        <StatCard label={`Revenue (${days} days)`} value={data ? formatMoney(data.revenue.paidCents) : '—'} loading={isLoading} />
        <StatCard
          label='Live tunnels'
          value={data?.tunnels.liveAgents ?? (data ? '—' : undefined)}
          hint={data ? (data.tunnels.hubReachable ? 'from the hub' : 'hub not reachable') : undefined}
          loading={isLoading}
        />
        <StatCard label='Active API keys' value={formatNumber(data?.apiKeys.active)} loading={isLoading} />
        <StatCard label='Open feedback' value={formatNumber(data?.feedback.open)} loading={isLoading} />
        <StatCard label='Connected sessions (DB)' value={formatNumber(data?.tunnels.connectedSessions)} loading={isLoading} />
      </Grid>

      <Grid minChildWidth='22rem' gap={4}>
        <Section title='Sign-ups' description={`New users per day, last ${days} days`}>
          <MiniBars label='Sign-ups' data={fillDays((data?.series.signups ?? []).map(d => ({ day: d.day, value: d.count })), days)} />
        </Section>
        <Section title='Tunnelled requests' description='Counted requests per day (usage pipeline)'>
          <MiniBars label='Requests' data={fillDays((data?.series.requests ?? []).map(d => ({ day: d.day, value: d.count })), days)} />
        </Section>
      </Grid>

      <Grid minChildWidth='22rem' gap={4}>
        <Section title='Accounts by status'>
          <div className='flex flex-wrap gap-3'>
            {Object.entries(data?.accounts.byStatus ?? {}).map(([status, count]) => (
              <Link key={status} href={`/accounts?status=${status}`} className='flex items-center gap-2' style={{ textDecoration: 'none' }}>
                <StatusBadge status={status} />
                <Text weight='medium'>{formatNumber(count)}</Text>
              </Link>
            ))}
            {data && Object.keys(data.accounts.byStatus).length === 0 && <Text tone='muted'>No accounts yet.</Text>}
          </div>
        </Section>
        <Section title='Subscriptions by plan'>
          <div className='flex flex-col gap-2'>
            {(data?.subscriptions.byPlan ?? []).map(r => (
              <div key={`${r.plan}-${r.status}`} className='flex items-center justify-between gap-2'>
                <Text>
                  {r.plan} <StatusBadge status={r.status} />
                </Text>
                <Text weight='medium'>{formatNumber(r.count)}</Text>
              </div>
            ))}
            {data && data.subscriptions.byPlan.length === 0 && <Text tone='muted'>No subscriptions yet.</Text>}
          </div>
        </Section>
      </Grid>
    </div>
  )
}
