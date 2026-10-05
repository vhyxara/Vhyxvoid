'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useQuery } from '@tanstack/react-query'

import { PageHeader, StatCard } from '@vhyxui/blocks'
import { Alert, Grid, SelectField, Tabs } from '@vhyxui/react'

import { platformKeys, usePlatformList } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { InvoiceRow, SubscriptionRow } from '@/api/platform/types'
import { MiniBars } from '@/components/ui/MiniBars'
import { Section } from '@/components/ui/Section'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { fillDays, formatDate, formatMoney, formatNumber } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

function Subscriptions() {
  const { params, set, searchInput, setSearchInput } = useListState(['status', 'plan'])
  const query = usePlatformList('billing-subs', platformService.subscriptions, params)

  return (
    <ServerTable<SubscriptionRow>
      query={query}
      page={Number(params.page)}
      onPageChange={p => set({ page: p }, false)}
      search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Account name or Stripe id' }}
      toolbar={
        <div style={{ minInlineSize: 150 }}>
          <SelectField
            name='status'
            label='Status'
            size='sm'
            value={String(params.status ?? 'all')}
            onValueChange={v => set({ status: v === 'all' ? undefined : v })}
            options={['all', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE'].map(s => ({ value: s, label: s === 'all' ? 'All' : s.toLowerCase().replace('_', ' ') }))}
          />
        </div>
      }
      emptyTitle='No subscriptions'
      columns={[
        { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
        { key: 'plan', header: 'Plan' },
        { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
        { key: 'currentPeriodEnd', header: 'Period end', cell: r => formatDate(r.currentPeriodEnd, false) },
        { key: 'trialEndsAt', header: 'Trial ends', cell: r => formatDate(r.trialEndsAt, false) },
        { key: 'cancel', header: 'Cancels', cell: r => (r.cancelAtPeriodEnd ? 'at period end' : '—') },
        { key: 'stripe', header: '', align: 'end', cell: r => <a href={r.stripeUrl} target='_blank' rel='noreferrer'>Stripe ↗</a> }
      ]}
    />
  )
}

function Invoices() {
  const { params, set, searchInput, setSearchInput } = useListState(['status'])
  const query = usePlatformList('billing-invoices', platformService.invoices, params)

  return (
    <ServerTable<InvoiceRow>
      query={query}
      page={Number(params.page)}
      onPageChange={p => set({ page: p }, false)}
      search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Account name or invoice id' }}
      toolbar={
        <div style={{ minInlineSize: 150 }}>
          <SelectField
            name='status'
            label='Status'
            size='sm'
            value={String(params.status ?? 'all')}
            onValueChange={v => set({ status: v === 'all' ? undefined : v })}
            options={['all', 'PAID', 'OPEN', 'UNCOLLECTIBLE', 'VOID', 'DRAFT'].map(s => ({ value: s, label: s === 'all' ? 'All' : s.toLowerCase() }))}
          />
        </div>
      }
      emptyTitle='No invoices'
      columns={[
        { key: 'createdAt', header: 'Date', cell: r => formatDate(r.createdAt, false) },
        { key: 'account', header: 'Account', cell: r => <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link> },
        { key: 'amountDue', header: 'Amount', align: 'end', cell: r => formatMoney(r.amountDue, r.currency) },
        { key: 'amountPaid', header: 'Paid', align: 'end', cell: r => formatMoney(r.amountPaid, r.currency) },
        { key: 'status', header: 'Status', cell: r => <StatusBadge status={r.status} /> },
        {
          key: 'links',
          header: '',
          align: 'end',
          cell: r => (
            <span className='flex gap-3 justify-end'>
              {r.hostedInvoiceUrl && (
                <a href={r.hostedInvoiceUrl} target='_blank' rel='noreferrer'>
                  Invoice ↗
                </a>
              )}
              <a href={r.stripeUrl} target='_blank' rel='noreferrer'>
                Stripe ↗
              </a>
            </span>
          )
        }
      ]}
    />
  )
}

export function BillingView() {
  const [days, setDays] = useState(30)
  const summary = useQuery({ queryKey: [...platformKeys.area('billing'), days], queryFn: () => platformService.billingSummary(days) })
  const s = summary.data
  const active = s?.subscriptions.filter(r => ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(r.status)).reduce((a, r) => a + r.count, 0)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Billing'
        description='Stripe is the source of truth for payments; refunds and plan changes happen there.'
        actions={[
          <div key='d' style={{ minInlineSize: 160 }}>
            <SelectField
              name='period'
              label='Period'
              size='sm'
              value={String(days)}
              onValueChange={v => setDays(Number(v))}
              options={[{ value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last 12 months' }]}
            />
          </div>
        ]}
      />
      {s && !s.stripeConfigured && <Alert variant='warning'>Stripe is not configured on the API, so no billing data will arrive.</Alert>}
      <Grid minChildWidth='13rem' gap={4}>
        <StatCard label='Revenue' value={s ? formatMoney(s.revenue.paidCents) : '—'} hint={s ? `${formatNumber(s.revenue.paidInvoices)} paid invoices` : undefined} loading={summary.isLoading} />
        <StatCard label='Paying subscriptions' value={formatNumber(active)} loading={summary.isLoading} />
        <StatCard label='Outstanding' value={s ? formatMoney(s.outstanding.cents) : '—'} hint={s ? `${s.outstanding.invoices} open invoices` : undefined} loading={summary.isLoading} />
        <StatCard label='Past due accounts' value={formatNumber(s?.pastDueAccounts)} loading={summary.isLoading} />
        <StatCard label='Trials ending in 7 days' value={formatNumber(s?.trialsEndingIn7Days)} loading={summary.isLoading} />
      </Grid>
      <Section title='Revenue per day'>
        <MiniBars label='Revenue' data={fillDays((s?.revenue.byDay ?? []).map(d => ({ day: d.day, value: d.cents })), days)} format={n => formatMoney(n)} />
      </Section>
      <Tabs defaultValue='subs' variant='underline'>
        <Tabs.List>
          <Tabs.Trigger value='subs'>Subscriptions</Tabs.Trigger>
          <Tabs.Trigger value='invoices'>Invoices</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value='subs'>
          <Subscriptions />
        </Tabs.Content>
        <Tabs.Content value='invoices'>
          <Invoices />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
