'use client'

// Traffic over time for a workspace (Tunnels page and dashboard overview):
// range and tunnel filters in one row above, headline numbers, the stacked
// requests chart and the busiest tunnels.

import { useState } from 'react'

import Link from 'next/link'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { Alert, Button, Card, SelectField, Skeleton } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { trafficService, type TrafficRange } from '@/api/infrastructure/services/traffic.service'
import { TrafficChart } from '@/components/charts/TrafficChart'
import { formatMs } from '@/components/charts/trafficChartModel'

export const trafficKeys = { get: (accountId: string, range: TrafficRange, label: string) => ['traffic', accountId, range, label] as const }

const RANGES: Array<{ value: TrafficRange; label: string; long: string }> = [
  { value: '1h', label: '1h', long: 'last hour' },
  { value: '24h', label: '24h', long: 'last 24 hours' },
  { value: '7d', label: '7d', long: 'last 7 days' }
]

const muted = { color: 'var(--vhyx-color-text-muted)' } as const

export function useTraffic(accountId: string, range: TrafficRange, label: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: trafficKeys.get(accountId, range, label),
    queryFn: () => trafficService.get(accountId, range, label || null),
    enabled: ready && !!accountId,
    refetchInterval: range === '1h' ? 30_000 : 120_000,
    placeholderData: keepPreviousData
  })
}

export function bucketPhrase(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const h = minutes / 60

  return `${h} hour${h === 1 ? '' : 's'}`
}

type Props = { accountId: string; compact?: boolean; title?: string }

export function TrafficCard({ accountId, compact, title = 'Traffic' }: Props) {
  const [range, setRange] = useState<TrafficRange>('24h')
  const [label, setLabel] = useState('')
  const { data, isLoading, isFetching, isPlaceholderData, error } = useTraffic(accountId, range, label)
  const rangeInfo = RANGES.find(r => r.value === range)!
  const labels = data?.top.map(t => t.label) ?? []

  return (
    <Card>
      <div className='flex flex-wrap items-start justify-between gap-3 mbe-4'>
        <div>
          <Typography variant='subtitle1'>{title}</Typography>
          <Typography variant='body2' style={muted}>
            Requests through your tunnels, {rangeInfo.long}
            {data ? `, per ${bucketPhrase(data.bucketMinutes)}` : ''}.
          </Typography>
        </div>
        <div className='flex flex-wrap items-end gap-2'>
          {!compact && (labels.length > 0 || label) && (
            <div style={{ minInlineSize: 160 }}>
              <SelectField
                name='traffic-label'
                label='Tunnel'
                value={label || '__all'}
                onValueChange={v => setLabel(v === '__all' ? '' : v)}
                options={[{ value: '__all', label: 'All tunnels' }, ...[...new Set([...labels, ...(label ? [label] : [])])].map(l => ({ value: l, label: l }))]}
              />
            </div>
          )}
          <div role='group' aria-label='Time range' className='flex gap-1'>
            {RANGES.map(r => (
              <Button key={r.value} size='sm' variant={r.value === range ? 'secondary' : 'ghost'} aria-pressed={r.value === range} onClick={() => setRange(r.value)}>
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <Alert variant='warning'>Traffic figures are unavailable right now.</Alert>
      ) : isLoading || !data ? (
        <Skeleton style={{ blockSize: 260 }} />
      ) : (
        <>
          <div className='grid gap-4 mbe-4' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))' }}>
            <Stat label='Requests' value={data.totals.requests.toLocaleString()} />
            <Stat
              label='Server errors (5xx)'
              value={data.totals.errorRate === null ? '—' : `${data.totals.errorRate}%`}
              hint={data.totals.errors5xx ? `${data.totals.errors5xx.toLocaleString()} requests` : undefined}
            />
            <Stat label='Client errors (4xx)' value={data.totals.errors4xx.toLocaleString()} />
            <Stat label='Average time' value={formatMs(data.totals.avgMs)} />
          </div>

          {data.totals.requests === 0 ? (
            <div className='py-8 text-center flex flex-col items-center gap-2'>
              <Typography variant='body2'>No requests {rangeInfo.long}.</Typography>
              <Typography variant='caption' style={muted}>
                Start a tunnel with <code>npx @vhyxvoid/agent init</code> and open its URL; traffic appears here within a minute.
              </Typography>
            </div>
          ) : (
            <TrafficChart
              series={data.series}
              bucketMinutes={data.bucketMinutes}
              label={`Requests per ${bucketPhrase(data.bucketMinutes)}, ${rangeInfo.long}${label ? `, tunnel ${label}` : ''}`}
              stale={isFetching && isPlaceholderData}
            />
          )}

          {!compact && !label && data.top.length > 1 && (
            <div className='mbs-4'>
              <Typography variant='subtitle2' style={{ marginBlockEnd: 6 }}>
                Busiest tunnels
              </Typography>
              <table style={{ inlineSize: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ ...muted, textAlign: 'end' }}>
                    <th style={{ textAlign: 'start', padding: '4px 0' }}>Tunnel</th>
                    <th style={{ padding: 4 }}>Requests</th>
                    <th style={{ padding: 4 }}>5xx</th>
                    <th style={{ padding: 4 }}>Avg time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.slice(0, 8).map(t => (
                    <tr key={t.label} style={{ textAlign: 'end', borderTop: '1px solid var(--vhyx-color-border)' }}>
                      <td style={{ textAlign: 'start', padding: '6px 0' }}>
                        <button
                          type='button'
                          onClick={() => setLabel(t.label)}
                          style={{ background: 'none', border: 0, padding: 0, color: 'var(--vhyx-color-text)', cursor: 'pointer', fontFamily: 'monospace' }}
                        >
                          {t.label}
                        </button>
                      </td>
                      <td style={{ padding: 4, fontVariantNumeric: 'tabular-nums' }}>{t.requests.toLocaleString()}</td>
                      <td style={{ padding: 4, fontVariantNumeric: 'tabular-nums' }}>{t.errorRate === null ? '—' : `${t.errorRate}%`}</td>
                      <td style={{ padding: 4, fontVariantNumeric: 'tabular-nums' }}>{formatMs(t.avgMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {compact && (
            <div className='mbs-3'>
              <Link href={`/organizations/${accountId}/tunnels`} style={{ color: 'var(--vhyx-color-accent)', fontSize: 14 }}>
                Traffic by tunnel →
              </Link>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <Typography variant='caption' style={muted}>
        {label}
      </Typography>
      <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--vhyx-color-text)' }}>{value}</div>
      {hint && (
        <Typography variant='caption' style={muted}>
          {hint}
        </Typography>
      )}
    </div>
  )
}
