'use client'

import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'

import { Badge, Card } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { GenericServerTable } from '@/libs/table/GenericServerTable'
import { useServerTable } from '@/libs/table/useServerTable'
import { useActiveTunnels, useTunnelHistoryTableList } from '@/api/application/hooks/useTunnels'
import type { TunnelStatus, ActiveTunnel, TunnelSession } from '@/api/domain/key-management/types/tunnel.types'

// ── Status helpers ────────────────────────────────────────────────────────

function statusBadgeVariant(status: TunnelStatus) {
  if (status === 'CONNECTED') return 'success' as const
  if (status === 'DISCONNECTED') return 'default' as const

  return 'danger' as const
}

function statusDot(status: TunnelStatus) {
  const colors = { CONNECTED: '#22c55e', DISCONNECTED: '#94a3b8', EVICTED: '#ef4444' }

  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: colors[status],
        ...(status === 'CONNECTED' && {
          boxShadow: '0 0 0 2px rgba(34,197,94,0.3)'
        })
      }}
    />
  )
}

function durationMs(ms: number | null) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`

  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

// ── Active tunnels card ───────────────────────────────────────────────────

function ActiveTunnelsCard({ accountId }: { accountId: string }) {
  const { data, isLoading } = useActiveTunnels(accountId)

  if (isLoading) return null

  const tunnels = data?.activeSessions ?? []

  return (
    <Card>
      <div className='flex justify-between items-center mb-4'>
        <div>
          <Typography variant='subtitle1'>Active tunnels</Typography>
          <Typography variant='body2'>Live connections — refreshes every 30s</Typography>
        </div>
        <Badge variant={data?.activeCount ? 'success' : 'default'} size='sm'>
          {`${data?.activeCount ?? 0} connected`}
        </Badge>
      </div>

      {tunnels.length === 0 ? (
        <div className='py-8 text-center'>
          <i className='tabler-plug-x text-4xl text-disabled mb-2' style={{ display: 'block' }} />
          <Typography variant='body2'>No active tunnels</Typography>
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {tunnels.map((tunnel: ActiveTunnel) => (
            <div
              key={tunnel.agentId}
              className='flex items-center gap-4 p-3 rounded-lg border'
              style={{ borderColor: 'var(--vhyx-color-border)' }}
            >
              {statusDot(tunnel.status)}
              <div className='flex-1'>
                <Typography variant='body2'>{tunnel.label}</Typography>
                <Typography variant='caption' style={{ fontFamily: 'monospace' }}>
                  {tunnel.agentId}
                </Typography>
              </div>
              {tunnel.apiKey && (
                <Badge variant='outline' size='sm'>
                  {tunnel.apiKey.name}
                </Badge>
              )}
              <Typography variant='caption'>{new Date(tunnel.connectedAt).toLocaleTimeString()}</Typography>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── History columns ───────────────────────────────────────────────────────

const hCol = createColumnHelper<TunnelSession>()

// Sortable columns verified live against the real local dev backend before
// shipping — the route's actual Zod validator (`tunnelHistoryQuerySchema`,
// `apps/api/.../tunnel.routes.ts`) accepts `sortBy: "connectedAt" |
// "disconnectedAt" | "label" | "status"`, matching `TunnelHistoryParams`'s
// type exactly and each column's own accessor id. `apiKey` (a nested
// object, no single sortable field) and `durationMs` (client-derived from
// connectedAt/disconnectedAt, not itself a backend field) have no matching
// backend option and stay non-sortable. See decision.md, 2026-09-16,
// "Phase 2: Tunnels converted".
const historyColumns: ColumnDef<TunnelSession, any>[] = [
  hCol.accessor('label', {
    header: 'Agent',
    enableSorting: true,
    cell: info => (
      <div>
        <Typography variant='body2'>{info.getValue()}</Typography>
        <Typography variant='caption' style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {info.row.original.agentId}
        </Typography>
      </div>
    )
  }),
  hCol.accessor('status', {
    header: 'Status',
    enableSorting: true,
    cell: info => (
      <Badge variant={statusBadgeVariant(info.getValue())} size='sm'>
        {info.getValue()}
      </Badge>
    )
  }),
  hCol.accessor('apiKey', {
    header: 'API key',
    enableSorting: false,
    cell: info =>
      info.getValue() ? (
        <Badge variant='outline' size='sm'>
          {info.getValue().name}
        </Badge>
      ) : (
        <Typography variant='body2'>—</Typography>
      )
  }),
  hCol.accessor('connectedAt', {
    header: 'Connected',
    enableSorting: true,
    cell: info => <Typography variant='body2'>{new Date(info.getValue()).toLocaleString()}</Typography>
  }),
  hCol.accessor('durationMs', {
    header: 'Duration',
    enableSorting: false,
    cell: info => <Typography variant='body2'>{durationMs(info.getValue())}</Typography>
  })
]

// ── Main view ─────────────────────────────────────────────────────────────

type Props = { accountId: string }

export default function TunnelsView({ accountId }: Props) {
  // Owns the real query now — GenericServerTable no longer fetches its own
  // data. `serverTable`'s params drive `useTunnelHistoryTableList`, keyed
  // through `tunnelKeys.history(accountId, params)` (the same factory
  // `useTunnelHistory` uses elsewhere), not an ad hoc `[tableKey, params]`
  // string. No point-fix existed here to remove — this screen has zero
  // mutations. See decision.md, 2026-09-16, "Phase 2: Tunnels converted".
  const serverTable = useServerTable(`tunnel-history-${accountId}`)
  const { data, isLoading, error } = useTunnelHistoryTableList(accountId, serverTable.params)

  return (
    <div className='flex flex-col gap-6'>
      <ActiveTunnelsCard accountId={accountId} />

      {/* Original MUI version wrapped this in a Card containing a single-item
          Tabs ("Session history") around GenericServerTable's own Card —
          a Tabs with only one tab has nothing to switch between, so it's
          simplified here to a plain heading instead of migrating the
          pointless tab affordance. See decision.md, 2026-09-10, "Step 5a". */}
      <div>
        <Typography variant='subtitle1' className='mb-2'>
          Session history
        </Typography>
        <GenericServerTable<TunnelSession>
          title=''
          columns={historyColumns}
          serverTable={serverTable}
          data={data?.items ?? []}
          isLoading={isLoading}
          error={error}
          total={data?.meta.total ?? 0}
          enableSearch
          filtersConfig={[
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Connected', value: 'CONNECTED' },
                { label: 'Disconnected', value: 'DISCONNECTED' },
                { label: 'Evicted', value: 'EVICTED' }
              ]
            }
          ]}
        />
      </div>
    </div>
  )
}
