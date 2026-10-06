'use client'

// Team activity: who changed what in the workspace, plus tunnel connects and
// disconnects, newest first, grouped by day. Owners and admins also see the
// IP address of each change and can export the last 30 days as CSV.

import { Fragment, useState } from 'react'

import { useInfiniteQuery } from '@tanstack/react-query'

import { Alert, Button, Card, SelectField, Skeleton, Switch, toast } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { activityService } from '@/api/infrastructure/services/activity.service'
import { dayHeading, describeActivity, isSystemEvent, type ActivityItem } from './activityFormat'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const

const CATEGORIES = [
  { value: 'all', label: 'Everything' },
  { value: 'members', label: 'Members and workspace' },
  { value: 'keys', label: 'API keys' },
  { value: 'tunnels', label: 'Tunnels, domains, inbox' },
  { value: 'alerts', label: 'Alerts' }
]

const ICONS: Record<string, string> = {
  members: 'tabler-users',
  keys: 'tabler-key',
  tunnels: 'tabler-plug',
  alerts: 'tabler-bell',
  other: 'tabler-point'
}

export default function ActivityView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const [category, setCategory] = useState('all')
  const [connections, setConnections] = useState(true)
  const [exporting, setExporting] = useState(false)

  const q = useInfiniteQuery({
    queryKey: ['activity', accountId, category, connections],
    queryFn: ({ pageParam }) => activityService.list(accountId, { category, connections, before: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextBefore,
    enabled: ready && !!accountId,
    refetchInterval: 60_000
  })

  const items = q.data?.pages.flatMap(p => p.items) ?? []
  const canExport = q.data?.pages[0]?.canExport ?? false

  async function exportCsv() {
    setExporting(true)

    try {
      const blob = await activityService.exportCsv(accountId, 30)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')

      a.href = url
      a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.danger((e as Error).message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  let lastDay = ''

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Activity'
        description='Who changed what in this workspace, and when tunnels came and went.'
        actions={
          canExport
            ? [
                <Button key='csv' variant='outline' loading={exporting} onClick={exportCsv}>
                  Export 30 days (CSV)
                </Button>
              ]
            : []
        }
      />

      <div className='flex flex-wrap items-end gap-4'>
        <div style={{ minInlineSize: 220 }}>
          <SelectField name='category' label='Show' value={category} onValueChange={setCategory} options={CATEGORIES} />
        </div>
        {(category === 'all' || category === 'tunnels') && (
          <label className='flex items-center gap-2' style={{ paddingBlockEnd: 6 }}>
            <Switch checked={connections} onCheckedChange={setConnections} aria-label='Include tunnel connects and disconnects' />
            <Typography variant='body2'>Tunnel connects and disconnects</Typography>
          </label>
        )}
      </div>

      {q.error ? <Alert variant='warning'>Activity could not be loaded. {(q.error as Error).message}</Alert> : null}

      <Card className='p-0'>
        {q.isLoading ? (
          <div className='p-6 flex flex-col gap-3'>
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} style={{ blockSize: 40 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className='p-10 text-center flex flex-col items-center gap-2'>
            <i className='tabler-history text-4xl' style={muted} aria-hidden />
            <Typography variant='body1'>Nothing here yet</Typography>
            <Typography variant='body2' style={muted}>
              Changes to keys, members, tunnels, domains and alerts show up here as they happen.
            </Typography>
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map(item => {
              const day = dayHeading(item.at)
              const header = day !== lastDay

              lastDay = day

              return (
                <Fragment key={item.id}>
                  {header && (
                    <li
                      aria-hidden
                      style={{ padding: '10px 20px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, ...muted, background: 'var(--vhyx-color-bg-subtle)' }}
                    >
                      {day}
                    </li>
                  )}
                  <ActivityRow item={item} day={day} />
                </Fragment>
              )
            })}
          </ol>
        )}
      </Card>

      {q.hasNextPage && (
        <div className='flex justify-center'>
          <Button variant='ghost' loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            Show older activity
          </Button>
        </div>
      )}
    </div>
  )
}

function ActivityRow({ item, day }: { item: ActivityItem; day: string }) {
  const system = isSystemEvent(item)
  const text = describeActivity(item)
  const time = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <li className='flex gap-3 items-start' style={{ padding: '12px 20px', borderTop: '1px solid var(--vhyx-color-border)' }}>
      <i className={ICONS[item.category] ?? ICONS.other} aria-hidden style={{ fontSize: 18, marginBlockStart: 2, ...muted }} />
      <div className='flex-1' style={{ minInlineSize: 0 }}>
        <Typography variant='body2' style={{ color: 'var(--vhyx-color-text)' }}>
          {system ? (
            text
          ) : (
            <>
              <strong>{item.actor?.name ?? 'Someone'}</strong> {text}
            </>
          )}
        </Typography>
        {(item.ipAddress || item.actor?.email) && (
          <Typography variant='caption' style={{ ...muted, display: 'block', overflowWrap: 'anywhere' }}>
            {[item.actor?.email, item.ipAddress ? `from ${item.ipAddress}` : null].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </div>
      <time dateTime={item.at} title={new Date(item.at).toLocaleString()} style={{ fontSize: 12, whiteSpace: 'nowrap', ...muted }}>
        <span className='sr-only'>{day}, </span>
        {time}
      </time>
    </li>
  )
}
