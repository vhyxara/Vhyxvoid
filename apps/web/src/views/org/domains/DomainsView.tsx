'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { domainsService, type CustomDomain, type DomainStatus } from '@/api/infrastructure/services/domainsAlerts.service'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

const keys = { overview: (a: string) => ['domains', a] as const }

export const DOMAIN_STATUS: Record<DomainStatus, { label: string; variant: 'success' | 'warning' | 'info' }> = {
  ACTIVE: { label: 'active', variant: 'success' },
  DNS_NOT_POINTING: { label: 'verified · DNS not pointing here', variant: 'warning' },
  PENDING_VERIFICATION: { label: 'waiting for DNS', variant: 'info' }
}

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

function RecordRow({ done, step, type, name, value, hint }: { done: boolean; step: number; type: string; name: string; value: string; hint: string }) {
  return (
    <div className='flex gap-3 items-start' style={{ paddingBlock: 8, borderBlockStart: '1px solid var(--vhyx-color-border)' }}>
      <span
        aria-hidden
        style={{
          inlineSize: 24,
          blockSize: 24,
          flex: '0 0 24px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 600,
          background: done ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-bg-muted)',
          color: done ? 'var(--vhyx-color-text-on-accent)' : 'var(--vhyx-color-text)'
        }}
      >
        {done ? '✓' : step}
      </span>
      <div className='flex flex-col gap-1' style={{ minInlineSize: 0, flex: 1 }}>
        <Typography variant='body2' style={{ fontWeight: 600 }}>
          {hint}
          <span className='sr-only'>{done ? ' (done)' : ''}</span>
        </Typography>
        <div className='grid gap-2' style={{ gridTemplateColumns: '4rem minmax(0, 1fr) minmax(0, 1.4fr)', alignItems: 'center' }}>
          <span style={{ ...mono, ...muted }}>{type}</span>
          <button type='button' onClick={() => copy(name)} title='Copy' style={{ ...mono, textAlign: 'start', background: 'var(--vhyx-color-bg-muted)', border: 0, borderRadius: 6, padding: '4px 8px', color: 'inherit', cursor: 'copy', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </button>
          <button type='button' onClick={() => copy(value)} title='Copy' style={{ ...mono, textAlign: 'start', background: 'var(--vhyx-color-bg-muted)', border: 0, borderRadius: 6, padding: '4px 8px', color: 'inherit', cursor: 'copy', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value}
          </button>
        </div>
      </div>
    </div>
  )
}

function DomainCard({ accountId, d, labels, canManage }: { accountId: string; d: CustomDomain; labels: string[]; canManage: boolean }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.overview(accountId) })
  const check = useMutation({
    mutationFn: () => domainsService.check(accountId, d.id),
    onSuccess: r => {
      toast[r.status === 'ACTIVE' ? 'success' : 'info'](r.status === 'ACTIVE' ? `${r.hostname} is live` : 'Checked. DNS changes can take a few minutes to appear.')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const move = useMutation({
    mutationFn: (label: string) => domainsService.move(accountId, d.id, label),
    onSuccess: r => {
      toast.success(`${r.hostname} now serves ${r.label}`)
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const remove = useMutation({
    mutationFn: () => domainsService.remove(accountId, d.id),
    onSuccess: () => {
      toast.success(`${d.hostname} removed`)
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const s = DOMAIN_STATUS[d.status]

  return (
    <Card className='p-4'>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex flex-col gap-1' style={{ minInlineSize: 0 }}>
            <div className='flex items-center gap-2 flex-wrap'>
              {d.status === 'ACTIVE' ? (
                <a href={d.url} target='_blank' rel='noreferrer' style={{ ...mono, fontWeight: 700, fontSize: 15, color: 'var(--vhyx-color-accent)' }}>
                  {d.hostname}
                </a>
              ) : (
                <span style={{ ...mono, fontWeight: 700, fontSize: 15 }}>{d.hostname}</span>
              )}
              <Badge size='sm' variant={s.variant}>
                {s.label}
              </Badge>
            </div>
            <Typography variant='caption' style={muted}>
              Serves the tunnel <span style={mono}>{d.label}</span>
              {d.lastCheckedAt ? ` · DNS checked ${new Date(d.lastCheckedAt).toLocaleString()}` : ''}
            </Typography>
          </div>
          <div className='flex gap-2 flex-wrap items-center'>
            {canManage && labels.length > 1 && (
              <div style={{ minInlineSize: 160 }}>
                <SelectField name={`label-${d.id}`} label='Tunnel' size='sm' value={d.label} onValueChange={v => v !== d.label && move.mutate(v)} options={labels.map(l => ({ value: l, label: l }))} />
              </div>
            )}
            <Button size='sm' variant='outline' loading={check.isPending} onClick={() => check.mutate()}>
              Check DNS now
            </Button>
            {canManage && (
              <Button size='sm' variant='ghost' loading={remove.isPending} onClick={() => remove.mutate()}>
                Remove
              </Button>
            )}
          </div>
        </div>

        {d.lastError && d.status !== 'ACTIVE' && <Alert variant='warning'>{d.lastError}</Alert>}

        {d.status !== 'ACTIVE' && (
          <div className='flex flex-col'>
            <Typography variant='body2' style={{ ...muted, marginBlockEnd: 4 }}>
              Add these records where your domain&apos;s DNS is hosted (Cloudflare, Route 53, your registrar…). We check automatically every few minutes; the
              certificate is issued on the first visit.
            </Typography>
            <RecordRow done={!!d.verifiedAt} step={1} type='TXT' name={d.records.verification.name} value={d.records.verification.value} hint='Prove you own the domain' />
            {d.records.routing && (
              <RecordRow
                done={d.routingOk}
                step={2}
                type='CNAME'
                name={d.records.routing.name}
                value={d.records.routing.value}
                hint='Point it at us (for a root domain, use your provider’s ALIAS/flattened CNAME)'
              />
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

export default function DomainsView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const { data: o, isLoading, error } = useQuery({ queryKey: keys.overview(accountId), queryFn: () => domainsService.overview(accountId), enabled: ready, refetchInterval: 30_000 })
  const [hostname, setHostname] = useState('')
  const [label, setLabel] = useState('')

  const add = useMutation({
    mutationFn: () => domainsService.add(accountId, hostname, label || o?.tunnelLabels[0] || ''),
    onSuccess: r => {
      toast.success(`${r.hostname} added. Now create its DNS records.`)
      setHostname('')
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const atLimit = !!o && o.domains.length >= o.maxDomains

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Typography variant='h4'>Custom domains</Typography>
        <Typography variant='body2' style={muted}>
          Serve a tunnel on your own hostname, like api.yourcompany.com, with HTTPS handled for you. Access rules, the inspector and the webhook inbox work the
          same as on the tunnel&apos;s own URL.
        </Typography>
      </div>

      {isLoading ? (
        <Skeleton height='12rem' />
      ) : error ? (
        <Alert variant='danger'>{(error as Error).message}</Alert>
      ) : !o ? null : !o.available ? (
        <Alert variant='info'>Custom domains are not available right now.</Alert>
      ) : (
        <>
          {o.maxDomains === 0 ? (
            <Alert variant='info' title='Not included in your plan'>
              <Link href={`/organizations/${accountId}/billing`}>See your plan</Link>.{o.domains.length ? ' Domains you already have keep working.' : ''}
            </Alert>
          ) : (
            o.canManage && (
              <Card className='p-4'>
                <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))', alignItems: 'end' }}>
                  <TextField name='hostname' label='Hostname' placeholder='api.yourcompany.com' value={hostname} onChange={e => setHostname(e.target.value)} />
                  {o.tunnelLabels.length ? (
                    <SelectField name='label' label='Tunnel' value={label || o.tunnelLabels[0]} onValueChange={setLabel} options={o.tunnelLabels.map(l => ({ value: l, label: l }))} />
                  ) : (
                    <TextField name='label' label='Tunnel label' placeholder='web' value={label} onChange={e => setLabel(e.target.value.trim())} hint='The --label your agent uses.' />
                  )}
                  <div>
                    <Button loading={add.isPending} disabled={!hostname.trim() || atLimit || !(label || o.tunnelLabels[0])} onClick={() => add.mutate()}>
                      Add domain
                    </Button>
                  </div>
                </div>
                <Typography variant='caption' style={{ ...muted, display: 'block', marginBlockStart: 8 }}>
                  {o.domains.length} of {o.maxDomains} used{atLimit ? ': remove one or upgrade to add more' : ''}.
                </Typography>
              </Card>
            )
          )}

          {o.domains.length === 0 ? (
            <Card className='p-8'>
              <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                <i className='tabler-world-www' style={{ fontSize: 36, ...muted }} />
                <Typography variant='h6'>No custom domains yet</Typography>
                <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                  Add a hostname you own, create two DNS records, and your tunnel answers on it with a certificate issued automatically.
                </Typography>
              </div>
            </Card>
          ) : (
            <div className='flex flex-col gap-3'>
              {o.domains.map(d => (
                <DomainCard key={d.id} accountId={accountId} d={d} labels={[...new Set([...o.tunnelLabels, d.label])]} canManage={o.canManage} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
