'use client'

import { useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Grid, Table, Text, toast } from '@vhyxui/react'

import { useSystemHealth } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { Probe } from '@/api/platform/types'
import { formatDate, formatNumber } from '@/components/ui/format'
import { KeyValue } from '@/components/ui/KeyValue'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'

const TITLES: Record<string, string> = {
  database: 'Database (Postgres)',
  redis: 'Redis',
  hub: 'Tunnel hub',
  email: 'Email',
  billing: 'Billing (Stripe)'
}

function ProbeCard({ name, probe }: { name: string; probe: Probe }) {
  const d = probe.details ?? {}

  return (
    <Section
      title={
        <span className='flex items-center gap-2'>
          {TITLES[name] ?? name} <StatusBadge status={probe.status} />
        </span>
      }
      description={probe.latencyMs !== undefined ? `${probe.latencyMs} ms` : undefined}
    >
      <div className='flex flex-col gap-3'>
        {probe.message && <Alert variant={probe.status === 'down' ? 'danger' : 'warning'}>{probe.message}</Alert>}
        {name === 'database' && d.migrations && (
          <KeyValue
            items={[
              ['Version', d.version],
              ['Size', d.sizeMb !== null ? `${formatNumber(d.sizeMb)} MB` : '—'],
              ['Connections', formatNumber(d.connections)],
              ['Migrations applied', `${d.migrations.applied} of ${d.migrations.onDisk ?? '?'}`],
              ['Pending', d.migrations.pending.length ? d.migrations.pending.join(', ') : 'none'],
              ['Failed', d.migrations.failed.length ? d.migrations.failed.join(', ') : 'none'],
              ['In DB, not in code', d.migrations.orphaned.length ? d.migrations.orphaned.join(', ') : 'none']
            ]}
          />
        )}
        {name === 'database' && Array.isArray(d.largestTables) && (
          <Table
            density='compact'
            columns={[
              { key: 'table', header: 'Largest tables' },
              { key: 'rows', header: 'Rows (estimate)', align: 'end', cell: (r: any) => formatNumber(r.rows) }
            ]}
            data={d.largestTables}
            rowKey={r => String(r.table)}
          />
        )}
        {name === 'hub' && probe.status === 'ok' && (
          <KeyValue
            items={[
              ['Instance', d.instanceId],
              ['Uptime', `${Math.round((d.uptimeSeconds ?? 0) / 3600)} h`],
              ['Agents', formatNumber(d.agents)],
              ['SDK sessions', formatNumber(d.sdks)],
              ['Requests in flight', formatNumber(d.pendingRequests)],
              ['Tunnel WebSockets', formatNumber(d.tunnelWebSockets)],
              ['Unregistered sockets', formatNumber(d.pendingAuthSockets)],
              ['Memory', `${d.memory?.heapUsedMb} MB heap / ${d.memory?.rssMb} MB RSS`]
            ]}
          />
        )}
      </div>
    </Section>
  )
}

export function SystemHealthView() {
  const { data, isLoading, isFetching, error, refetch } = useSystemHealth()
  const api = data?.api.details
  const [runningAlerts, setRunningAlerts] = useState(false)
  const [runningNotices, setRunningNotices] = useState(false)

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='System health'
        description='Each dependency is checked on its own: one failing never hides the others.'
        actions={[
          <Button
            key='alerts'
            variant='ghost'
            size='sm'
            loading={runningAlerts}
            onClick={() => {
              setRunningAlerts(true)
              platformService
                .runJob('alerts')
                .then(r => toast.success(`Alert rules evaluated in ${r.ms} ms`))
                .catch(e => toast.danger(e.message))
                .finally(() => setRunningAlerts(false))
            }}
          >
            Run alert checks now
          </Button>,
          <Button
            key='notices'
            variant='ghost'
            size='sm'
            loading={runningNotices}
            onClick={() => {
              setRunningNotices(true)
              platformService
                .runJob('notices')
                .then(r => {
                  const res = r.result as { usage?: number; trial?: number } | undefined

                  toast.success(`Usage and trial notices: ${res?.usage ?? 0} usage, ${res?.trial ?? 0} trial sent`)
                })
                .catch(e => toast.danger(e.message))
                .finally(() => setRunningNotices(false))
            }}
          >
            Send due usage/trial notices
          </Button>,
          <Button key='r' variant='outline' size='sm' loading={isFetching} onClick={() => refetch()}>
            Check again
          </Button>
        ]}
      />
      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}
      {isLoading && <Text tone='muted'>Checking…</Text>}
      {data && (
        <>
          <Alert variant={data.status === 'ok' ? 'success' : data.status === 'degraded' ? 'warning' : 'danger'} title={`Overall: ${data.status}`}>
            Checked {formatDate(data.checkedAt)}.
          </Alert>
          <Section title='API'>
            <KeyValue
              items={[
                ['Version', api?.version],
                ['Built', api?.builtAt ? formatDate(api.builtAt) : '—'],
                ['Node', api?.node],
                ['Environment', api?.env],
                ['Uptime', `${Math.round((api?.uptimeSeconds ?? 0) / 60)} min`],
                ['Memory', `${api?.heapUsedMb} MB heap / ${api?.rssMb} MB RSS`],
                ...Object.entries(api?.configured ?? {}).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'configured' : 'missing') : String(v ?? '—')] as [string, string])
              ]}
            />
          </Section>
          <Grid minChildWidth='22rem' gap={4}>
            {Object.entries(data.probes).map(([name, probe]) => (
              <ProbeCard key={name} name={name} probe={probe} />
            ))}
          </Grid>
        </>
      )}
    </div>
  )
}
