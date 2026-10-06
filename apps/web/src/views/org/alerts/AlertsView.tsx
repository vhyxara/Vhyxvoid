'use client'

import { useState } from 'react'

import Link from 'next/link'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, Switch, TextareaField, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { alertsService, type AlertEvent, type AlertRule, type AlertRuleInput, type AlertType } from '@/api/infrastructure/services/domainsAlerts.service'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const keys = { overview: (a: string) => ['alerts', a] as const }

/** What each alert type asks for, with the defaults the server uses. */
export const ALERT_TYPE_INFO: Record<
  AlertType,
  { title: string; help: string; label: boolean; threshold?: { label: string; default: number }; window?: { label: string; default: number }; minRequests?: number }
> = {
  TUNNEL_OFFLINE: { title: 'Tunnel offline', help: 'When a tunnel’s agent disconnects and stays away.', label: true, window: { label: 'Minutes offline before alerting', default: 5 } },
  ERROR_RATE: {
    title: 'Server errors',
    help: 'When too many requests to a tunnel get a 5xx answer.',
    label: true,
    threshold: { label: 'Error rate (%)', default: 10 },
    window: { label: 'Over the last (minutes)', default: 5 },
    minRequests: 20
  },
  USAGE: { title: 'Monthly usage', help: 'When this month’s requests reach a share of your plan.', label: false, threshold: { label: 'Percent of the plan', default: 80 } },
  INBOX_FAILED: { title: 'Webhook delivery failed', help: 'When a webhook held by the inbox gives up after its retries.', label: true },
  DOMAIN: { title: 'Custom domain changes', help: 'When a custom domain is verified, or stops pointing at us.', label: false }
}

/** Form state -> API body: empty strings become null, numbers parsed, irrelevant fields dropped. */
export function toRuleInput(f: FormState): AlertRuleInput {
  const info = ALERT_TYPE_INFO[f.type]
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  return {
    type: f.type,
    name: f.name.trim(),
    label: info.label && f.label.trim() ? f.label.trim() : null,
    threshold: info.threshold ? num(f.threshold) : null,
    windowMinutes: info.window ? num(f.windowMinutes) : null,
    minRequests: info.minRequests ? num(f.minRequests) : null,
    notifyMembers: f.notifyMembers,
    emails: f.emails
      .split(/[\s,;]+/)
      .map(e => e.trim())
      .filter(Boolean),
    webhookUrl: f.webhookUrl.trim() || null
  }
}

type FormState = {
  type: AlertType
  name: string
  label: string
  threshold: string
  windowMinutes: string
  minRequests: string
  notifyMembers: boolean
  emails: string
  webhookUrl: string
}

function initialForm(rule: AlertRule | null): FormState {
  const type = rule?.type ?? 'TUNNEL_OFFLINE'
  const info = ALERT_TYPE_INFO[type]

  return {
    type,
    name: rule?.name ?? info.title,
    label: rule?.label ?? '',
    threshold: String(rule?.threshold ?? info.threshold?.default ?? ''),
    windowMinutes: String(rule?.windowMinutes ?? info.window?.default ?? ''),
    minRequests: String(rule?.minRequests ?? info.minRequests ?? ''),
    notifyMembers: rule?.notifyMembers ?? true,
    emails: rule?.emails.join('\n') ?? '',
    webhookUrl: rule?.webhookUrl ?? ''
  }
}

function RuleDialog({ accountId, rule, labels, onClose }: { accountId: string; rule: AlertRule | null; labels: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<FormState>(() => initialForm(rule))
  const set = (patch: Partial<FormState>) => setF(prev => ({ ...prev, ...patch }))
  const info = ALERT_TYPE_INFO[f.type]

  const save = useMutation({
    mutationFn: () => {
      const body = toRuleInput(f)

      if (rule) {
        const { type: _t, ...rest } = body

        return alertsService.update(accountId, rule.id, rest)
      }

      return alertsService.create(accountId, body)
    },
    onSuccess: r => {
      toast.success(rule ? 'Alert updated' : `Alert “${r.name}” created`)
      qc.invalidateQueries({ queryKey: keys.overview(accountId) })
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{rule ? `Edit “${rule.name}”` : 'New alert'}</Dialog.Title>
          <div className='flex flex-col gap-4'>
            {!rule && (
              <SelectField
                name='type'
                label='Alert me when'
                value={f.type}
                onValueChange={v => {
                  const t = v as AlertType
                  const i = ALERT_TYPE_INFO[t]

                  set({ type: t, name: i.title, threshold: String(i.threshold?.default ?? ''), windowMinutes: String(i.window?.default ?? ''), minRequests: String(i.minRequests ?? '') })
                }}
                options={(Object.keys(ALERT_TYPE_INFO) as AlertType[]).map(t => ({ value: t, label: ALERT_TYPE_INFO[t].title }))}
                hint={info.help}
              />
            )}
            <TextField name='name' label='Name' value={f.name} maxLength={80} onChange={e => set({ name: e.target.value })} />
            {info.label && (
              <SelectField
                name='label'
                label='Tunnel'
                value={f.label || '__all'}
                onValueChange={v => set({ label: v === '__all' ? '' : v })}
                options={[{ value: '__all', label: 'Any tunnel' }, ...[...new Set([...labels, ...(f.label ? [f.label] : [])])].map(l => ({ value: l, label: l }))]}
              />
            )}
            <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
              {info.threshold && <TextField name='threshold' type='number' label={info.threshold.label} min={1} max={100} value={f.threshold} onChange={e => set({ threshold: e.target.value })} />}
              {info.window && <TextField name='window' type='number' label={info.window.label} min={1} max={1440} value={f.windowMinutes} onChange={e => set({ windowMinutes: e.target.value })} />}
              {info.minRequests !== undefined && (
                <TextField name='minRequests' type='number' label='Only with at least (requests)' min={1} value={f.minRequests} onChange={e => set({ minRequests: e.target.value })} />
              )}
            </div>

            <Typography variant='subtitle2'>Send to</Typography>
            <label className='flex items-center gap-2'>
              <Switch checked={f.notifyMembers} onCheckedChange={v => set({ notifyMembers: v })} aria-label='Owners and admins' />
              <Typography variant='body2'>Owners and admins of this workspace (email and in the dashboard)</Typography>
            </label>
            <TextareaField name='emails' label='Other email addresses' rows={2} value={f.emails} onChange={e => set({ emails: e.target.value })} hint='Up to 10, one per line, e.g. an on-call list.' />
            <TextField
              name='webhook'
              label='Webhook URL'
              placeholder='https://hooks.slack.com/services/…'
              value={f.webhookUrl}
              onChange={e => set({ webhookUrl: e.target.value })}
              hint='Slack and Discord incoming webhooks work as they are; other services get JSON.'
            />
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose} type='button'>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
              {rule ? 'Save' : 'Create alert'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

export function deliverySummary(d: AlertEvent['deliveries']): string {
  if (!d) return ''
  if (d.suppressed) return 'not sent (hourly limit)'
  const parts: string[] = []

  if (typeof d.email === 'number') parts.push(`${d.email} email${d.email === 1 ? '' : 's'}`)
  if (typeof d.inApp === 'number') parts.push(`${d.inApp} in-app`)
  if (typeof d.webhook === 'string') parts.push(d.webhook === 'ok' ? 'webhook ok' : `webhook ${d.webhook}`)

  return parts.join(' · ')
}

const KIND: Record<AlertEvent['kind'], { label: string; variant: 'danger' | 'success' | 'info' }> = {
  FIRING: { label: 'alert', variant: 'danger' },
  RESOLVED: { label: 'resolved', variant: 'success' },
  EVENT: { label: 'notice', variant: 'info' }
}

export default function AlertsView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const { data: o, isLoading, error } = useQuery({ queryKey: keys.overview(accountId), queryFn: () => alertsService.overview(accountId), enabled: ready, refetchInterval: 30_000 })
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: keys.overview(accountId) })

  const toggle = useMutation({
    mutationFn: (r: AlertRule) => alertsService.update(accountId, r.id, { enabled: !r.enabled }),
    onSuccess: refresh,
    onError: e => toast.danger((e as Error).message)
  })
  const remove = useMutation({
    mutationFn: (r: AlertRule) => alertsService.remove(accountId, r.id),
    onSuccess: () => {
      toast.success('Alert removed')
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })
  const test = useMutation({
    mutationFn: (r: AlertRule) => alertsService.test(accountId, r.id),
    onSuccess: res => {
      if (res.suppressed) toast.warning('Not sent: this alert reached its hourly limit')
      else toast.success(`Test sent: ${deliverySummary(res.deliveries) || 'no channel set'}`)
      refresh()
    },
    onError: e => toast.danger((e as Error).message)
  })

  const atLimit = !!o && o.rules.length >= o.maxRules

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <Typography variant='h4'>Alerts</Typography>
          <Typography variant='body2' style={muted}>
            Hear about problems before your users do: by email, in the dashboard, or in Slack and other tools through a webhook. You get one message when
            something goes wrong and one when it recovers.
          </Typography>
        </div>
        {o?.canManage && o.available && (
          <Button icon={<i className='tabler-bell-plus' />} disabled={atLimit} onClick={() => setEditing('new')}>
            New alert
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton height='12rem' />
      ) : error ? (
        <Alert variant='danger'>{(error as Error).message}</Alert>
      ) : !o ? null : !o.available ? (
        <Alert variant='info' title='Alerts are not available'>
          {o.maxRules === 0 ? (
            <>
              Not included in your plan. <Link href={`/organizations/${accountId}/billing`}>See your plan</Link>.
            </>
          ) : (
            'Alerts are switched off for now.'
          )}
        </Alert>
      ) : (
        <>
          {atLimit && <Alert variant='info'>You have {o.maxRules} alerts, the most your plan allows.</Alert>}
          {o.rules.length === 0 ? (
            <Card className='p-8'>
              <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                <i className='tabler-bell' style={{ fontSize: 36, ...muted }} />
                <Typography variant='h6'>No alerts yet</Typography>
                <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                  A good first one: “Tunnel offline” for your production tunnel, sent to your team’s Slack channel.
                </Typography>
              </div>
            </Card>
          ) : (
            <div className='flex flex-col gap-3'>
              {o.rules.map(r => (
                <Card key={r.id} className='p-4'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='flex flex-col gap-1' style={{ minInlineSize: 0 }}>
                      <div className='flex items-center gap-2 flex-wrap'>
                        <Typography variant='body1' style={{ fontWeight: 600 }}>
                          {r.name}
                        </Typography>
                        {!r.enabled && (
                          <Badge size='sm' variant='default'>
                            off
                          </Badge>
                        )}
                        {r.firing?.map(f => (
                          <Badge key={f.subject} size='sm' variant='danger'>
                            firing{f.subject.startsWith('usage:') ? '' : `: ${f.subject}`}
                          </Badge>
                        ))}
                      </div>
                      <Typography variant='body2' style={muted}>
                        {r.description}
                      </Typography>
                      <Typography variant='caption' style={muted}>
                        {[r.notifyMembers ? 'owners & admins' : null, r.emails.length ? `${r.emails.length} other email${r.emails.length === 1 ? '' : 's'}` : null, r.webhookUrl ? 'webhook' : null]
                          .filter(Boolean)
                          .join(' · ') || 'no channel: add one to be notified'}
                      </Typography>
                    </div>
                    {o.canManage && (
                      <div className='flex items-center gap-2 flex-wrap'>
                        <Switch checked={r.enabled} onCheckedChange={() => toggle.mutate(r)} aria-label={`${r.name} on`} />
                        <Button size='sm' variant='outline' loading={test.isPending && test.variables?.id === r.id} onClick={() => test.mutate(r)}>
                          Send test
                        </Button>
                        <Button size='sm' variant='outline' onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                        <Button size='sm' variant='ghost' onClick={() => remove.mutate(r)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <section className='flex flex-col gap-2'>
            <Typography variant='h6'>Recent</Typography>
            {o.events.length === 0 ? (
              <Typography variant='body2' style={muted}>
                Nothing has happened yet.
              </Typography>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {o.events.map(e => (
                  <div key={e.id} className='flex flex-wrap gap-x-3 gap-y-1 items-baseline' style={{ padding: '10px 14px', borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
                    <span style={{ ...muted, fontSize: 12, minInlineSize: 140 }}>{new Date(e.createdAt).toLocaleString()}</span>
                    <Badge size='sm' variant={KIND[e.kind].variant}>
                      {KIND[e.kind].label}
                    </Badge>
                    <span style={{ fontWeight: 500, flex: '1 1 16rem' }}>{e.title}</span>
                    <span style={{ ...muted, fontSize: 12 }}>
                      {e.ruleName} · {deliverySummary(e.deliveries)}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      )}

      {editing && o && <RuleDialog key={editing === 'new' ? 'new' : editing.id} accountId={accountId} rule={editing === 'new' ? null : editing} labels={o.tunnelLabels} onClose={() => setEditing(null)} />}
    </div>
  )
}

