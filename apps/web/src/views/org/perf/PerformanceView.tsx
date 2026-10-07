'use client'

// Performance: what your API does under real traffic (Analytics), under load
// you generate (Load tests), and on a schedule (Monitors). The tab is in the
// URL (?tab=analytics|load|monitors) so alerts can link straight to a monitor.

import { useRouter, useSearchParams } from 'next/navigation'

import { Tabs } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import AnalyticsTab from './AnalyticsTab'
import LoadTestsTab from './LoadTestsTab'
import MonitorsTab from './MonitorsTab'

const TABS = ['analytics', 'load', 'monitors'] as const

export default function PerformanceView({ accountId }: { accountId: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const raw = params.get('tab')
  const tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as (typeof TABS)[number]) : 'analytics'

  const setTab = (t: string) => {
    const next = new URLSearchParams(params.toString())

    next.set('tab', t)
    next.delete('monitor')
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Performance'
        description='Per-endpoint speed and errors from real traffic, load tests against your own tunnels and mocks, and monitors that run your API collections on a schedule and alert you when they fail.'
      />
      <Tabs value={tab} onValueChange={setTab} variant='underline'>
        <Tabs.List style={{ overflowX: 'auto', flexWrap: 'nowrap' }}>
          <Tabs.Trigger value='analytics'>API analytics</Tabs.Trigger>
          <Tabs.Trigger value='load'>Load tests</Tabs.Trigger>
          <Tabs.Trigger value='monitors'>Monitors</Tabs.Trigger>
        </Tabs.List>
        <div className='mbs-4'>
          <Tabs.Content value='analytics'>
            <AnalyticsTab accountId={accountId} />
          </Tabs.Content>
          <Tabs.Content value='load'>
            <LoadTestsTab accountId={accountId} />
          </Tabs.Content>
          <Tabs.Content value='monitors'>
            <MonitorsTab accountId={accountId} initialMonitor={params.get('monitor')} />
          </Tabs.Content>
        </div>
      </Tabs>
    </div>
  )
}
