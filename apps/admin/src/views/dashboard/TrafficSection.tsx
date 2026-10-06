'use client'

import { useState } from 'react'

import Link from 'next/link'

import { Alert, Button, Text } from '@vhyxui/react'

import { useTraffic } from '@/api/platform/hooks'
import { formatNumber } from '@/components/ui/format'
import { MiniBars } from '@/components/ui/MiniBars'
import { Section } from '@/components/ui/Section'

type Range = '1h' | '24h' | '7d'

const RANGE_LABEL: Record<Range, string> = { '1h': 'last hour', '24h': 'last 24 hours', '7d': 'last 7 days' }

function bucketName(iso: string, minutes: number) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return minutes >= 60 ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}` : time
}

const ms = (v: number | null) => (v === null ? '—' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(2)} s`)

/** Live platform traffic from the hub's per-minute stats (all accounts). */
export function TrafficSection() {
  const [range, setRange] = useState<Range>('24h')
  const { data, error, isLoading } = useTraffic(range)

  return (
    <Section
      title='Live traffic'
      description={`Requests through every tunnel, ${RANGE_LABEL[range]}${data ? ` (per ${data.bucketMinutes >= 60 ? `${data.bucketMinutes / 60} h` : `${data.bucketMinutes} min`})` : ''}`}
    >
      <div className='flex flex-col gap-4'>
        <div role='group' aria-label='Time range' className='flex gap-1'>
          {(Object.keys(RANGE_LABEL) as Range[]).map(r => (
            <Button key={r} size='sm' variant={r === range ? 'secondary' : 'ghost'} aria-pressed={r === range} onClick={() => setRange(r)}>
              {r}
            </Button>
          ))}
        </div>

        {error ? <Alert variant='warning'>{(error as Error).message}</Alert> : null}

        {isLoading || !data ? (
          <Text tone='muted'>Loading…</Text>
        ) : (
          <>
            <div className='flex flex-wrap gap-6'>
              <Figure label='Requests' value={formatNumber(data.totals.requests)} />
              <Figure label='5xx rate' value={data.totals.errorRate === null ? '—' : `${data.totals.errorRate}%`} />
              <Figure label='4xx' value={formatNumber(data.totals.errors4xx)} />
              <Figure label='Average time' value={ms(data.totals.avgMs)} />
            </div>
            <MiniBars label='Requests' data={data.series.map(p => ({ day: bucketName(p.t, data.bucketMinutes), value: p.requests }))} />
            {data.top.length > 0 && (
              <table style={{ inlineSize: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'end', color: 'var(--vhyx-color-text-muted)' }}>
                    <th style={{ textAlign: 'start', padding: '4px 0' }}>Busiest accounts</th>
                    <th style={{ padding: 4 }}>Requests</th>
                    <th style={{ padding: 4 }}>5xx</th>
                    <th style={{ padding: 4 }}>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map(t => (
                    <tr key={t.accountId} style={{ textAlign: 'end', borderTop: '1px solid var(--vhyx-color-border)' }}>
                      <td style={{ textAlign: 'start', padding: '6px 0' }}>
                        <Link href={`/accounts/${t.accountId}`}>{t.name ?? t.slug ?? t.accountId}</Link>
                      </td>
                      <td style={{ padding: 4 }}>{formatNumber(t.requests)}</td>
                      <td style={{ padding: 4 }}>{t.errorRate === null ? '—' : `${t.errorRate}%`}</td>
                      <td style={{ padding: 4 }}>{ms(t.avgMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </Section>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size='xs' tone='muted'>
        {label}
      </Text>
      <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}
