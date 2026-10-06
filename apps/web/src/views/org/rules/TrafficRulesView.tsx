'use client'

// Traffic rules for one tunnel at a time: an ordered list the hub applies
// before requests reach the agent. Edits stay a draft until Save (the whole
// list is saved at once, so order is never half-applied). "Test a request"
// runs the draft through the same engine the hub uses.

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Dialog, SelectField, Skeleton, Switch, TextareaField, TextField, toast } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { Typography } from '@/components/vhyxui-shims'
import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { trafficRulesService, type RuleMethod, type RulePlan, type TrafficRule } from '@/api/infrastructure/services/trafficRules.service'
import { ACTION_INFO, DRAFT_KEY, METHODS, TEMPLATES, blankForm, formFromRule, ruleFromForm, summarize, type RuleForm } from './rulesForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const
const keys = { overview: (a: string) => ['traffic-rules', a] as const }
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

export default function TrafficRulesView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const qc = useQueryClient()
  const search = useSearchParams()
  const { data: o, isLoading, error } = useQuery({ queryKey: keys.overview(accountId), queryFn: () => trafficRulesService.overview(accountId), enabled: ready })

  const [label, setLabel] = useState<string>(search.get('label') ?? '')
  const [draft, setDraft] = useState<TrafficRule[] | null>(null)
  const [editing, setEditing] = useState<RuleForm | null>(null)
  const [newLabel, setNewLabel] = useState('')

  const labels = useMemo(() => [...new Set([...(o?.tunnels.map(t => t.label) ?? []), ...(o?.liveLabels ?? []), ...(label ? [label] : [])])].sort(), [o, label])
  const saved = o?.tunnels.find(t => t.label === label)
  const rules = draft ?? saved?.rules ?? []
  const dirty = draft !== null
  const canEdit = !!o?.canManage && !!o?.enabled && o.maxRules > 0

  // Default to the first tunnel once data arrives.
  useEffect(() => {
    if (!label && labels.length) setLabel(labels[0])
  }, [label, labels])

  // "Mock this response" from the inspector leaves a rule in sessionStorage.
  useEffect(() => {
    if (!o || search.get('draft') !== '1') return
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)

      if (raw) {
        sessionStorage.removeItem(DRAFT_KEY)
        const rule = JSON.parse(raw) as TrafficRule
        const current = o.tunnels.find(t => t.label === (search.get('label') ?? label))?.rules ?? []

        setDraft([rule, ...current])
        setEditing(formFromRule(rule))
      }
    } catch {
      // storage unavailable: nothing to restore
    }
  }, [o, search, label])

  const save = useMutation({
    mutationFn: () => trafficRulesService.save(accountId, label, rules, saved?.version ?? 0),
    onSuccess: r => {
      toast.success(r.rules.length ? `Saved ${r.rules.length} rule${r.rules.length === 1 ? '' : 's'}; live within seconds` : 'Rules removed')
      if (r.warning) toast.warning(r.warning)
      setDraft(null)
      void qc.invalidateQueries({ queryKey: keys.overview(accountId) })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const change = (next: TrafficRule[]) => setDraft(next)

  const move = (i: number, d: -1 | 1) => {
    const next = [...rules]
    const j = i + d

    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    change(next)
  }

  function switchTunnel(l: string) {
    if (dirty && !window.confirm('Discard unsaved changes to this tunnel’s rules?')) return
    setDraft(null)
    setLabel(l)
  }

  const atLimit = !!o && rules.length >= o.maxRules

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Traffic rules'
        description='Answer with mocks, inject errors and latency, redirect, rewrite paths and change headers, before a request reaches your machine. Rules run top to bottom; the first one that answers wins.'
      />

      {error ? <Alert variant='danger'>{(error as Error).message}</Alert> : null}
      {o && !o.enabled && <Alert variant='info'>Traffic rules are switched off on this platform right now. Saved rules apply again once they are back.</Alert>}
      {o && o.enabled && o.maxRules === 0 && (
        <Alert variant='info' title='Not on this plan'>
          Traffic rules are part of paid plans. <Link href={`/organizations/${accountId}/billing`}>See plans</Link>.
        </Alert>
      )}
      {o && o.enabled && o.maxRules > 0 && !o.canManage && <Alert variant='info'>Only owners and admins can change rules. You can still test requests against them.</Alert>}

      {isLoading || !o ? (
        <Skeleton height='16rem' />
      ) : (
        <>
          <div className='flex flex-wrap items-end gap-3'>
            {labels.length > 0 && (
              <div style={{ minInlineSize: 220 }}>
                <SelectField
                  name='tunnel'
                  label='Tunnel'
                  value={label}
                  onValueChange={switchTunnel}
                  options={labels.map(l => ({
                    value: l,
                    label: `${l}${o.liveLabels.includes(l) ? ' · live' : ''}${o.tunnels.find(t => t.label === l)?.rules.length ? ` · ${o.tunnels.find(t => t.label === l)!.rules.length} rules` : ''}`
                  }))}
                />
              </div>
            )}
            {canEdit && (
              <form
                className='flex items-end gap-2'
                onSubmit={e => {
                  e.preventDefault()
                  const l = newLabel.trim().toLowerCase()

                  if (!LABEL_RE.test(l)) return toast.danger('Use the label you start the agent with: lowercase letters, digits and hyphens')
                  setNewLabel('')
                  switchTunnel(l)
                }}
              >
                <TextField name='newLabel' label='Another tunnel (label)' placeholder='e.g. api' value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                <Button type='submit' variant='outline'>
                  Open
                </Button>
              </form>
            )}
          </div>

          {!label ? (
            <Card className='p-8'>
              <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
                <i className='tabler-route' style={{ fontSize: 36, ...muted }} aria-hidden />
                <Typography variant='h6'>No tunnels yet</Typography>
                <Typography variant='body2' style={{ ...muted, maxInlineSize: 520 }}>
                  Start a tunnel, or type the label you will start it with above. Rules belong to a tunnel label and survive agent restarts.
                </Typography>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <div className='flex flex-wrap items-center justify-between gap-3 mbe-3'>
                  <div>
                    <Typography variant='subtitle1'>
                      Rules for <span style={mono}>{label}</span>
                    </Typography>
                    <Typography variant='body2' style={muted}>
                      {rules.length} of {o.maxRules} rules{saved ? ` · saved ${new Date(saved.updatedAt).toLocaleString()}` : ''}
                    </Typography>
                  </div>
                  {canEdit && (
                    <Button onClick={() => setEditing(blankForm('mock'))} disabled={atLimit}>
                      Add rule
                    </Button>
                  )}
                </div>

                {rules.length === 0 ? (
                  <Typography variant='body2' style={{ ...muted, padding: '12px 0' }}>
                    No rules: every request goes to your app as it is. Start from a template below or add your own.
                  </Typography>
                ) : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {rules.map((r, i) => {
                      const info = ACTION_INFO[r.action.type]

                      return (
                        <li key={r.id} className='flex flex-wrap items-center gap-3' style={{ padding: '10px 0', borderTop: '1px solid var(--vhyx-color-border)', opacity: r.enabled ? 1 : 0.55 }}>
                          <span style={{ ...mono, ...muted, inlineSize: 20, textAlign: 'end' }}>{i + 1}</span>
                          <Switch
                            checked={r.enabled}
                            disabled={!canEdit}
                            onCheckedChange={(v: boolean) => change(rules.map(x => (x.id === r.id ? { ...x, enabled: v } : x)))}
                            aria-label={`Rule ${r.name} enabled`}
                          />
                          <div style={{ flex: 1, minInlineSize: 200 }}>
                            <div className='flex flex-wrap items-center gap-2'>
                              <Typography variant='body2' style={{ fontWeight: 600, color: 'var(--vhyx-color-text)' }}>
                                {r.name}
                              </Typography>
                              <Badge size='sm' variant={info.answers ? 'warning' : 'default'}>
                                {info.answers ? 'answers' : 'changes'}
                              </Badge>
                              {r.when === 'offline' && (
                                <Badge size='sm' variant='outline'>
                                  offline only
                                </Badge>
                              )}
                            </div>
                            <Typography variant='caption' style={{ ...mono, ...muted, overflowWrap: 'anywhere' }}>
                              {summarize(r)}
                            </Typography>
                          </div>
                          {canEdit && (
                            <div className='flex gap-1'>
                              <Button size='sm' variant='ghost' aria-label='Move up' disabled={i === 0} onClick={() => move(i, -1)}>
                                ↑
                              </Button>
                              <Button size='sm' variant='ghost' aria-label='Move down' disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                                ↓
                              </Button>
                              <Button size='sm' variant='ghost' onClick={() => setEditing(formFromRule(r))}>
                                Edit
                              </Button>
                              <Button size='sm' variant='ghost' onClick={() => change(rules.filter(x => x.id !== r.id))}>
                                Remove
                              </Button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}

                {dirty && (
                  <div className='flex flex-wrap items-center justify-between gap-3 mbs-3' style={{ padding: 12, borderRadius: 8, background: 'var(--vhyx-color-accent-subtle)' }}>
                    <Typography variant='body2'>Unsaved changes. Nothing changes for live traffic until you save.</Typography>
                    <div className='flex gap-2'>
                      <Button variant='ghost' onClick={() => setDraft(null)}>
                        Discard
                      </Button>
                      <Button onClick={() => save.mutate()} loading={save.isPending}>
                        Save rules
                      </Button>
                    </div>
                  </div>
                )}
              </Card>

              {canEdit && (
                <div>
                  <Typography variant='subtitle2' style={{ marginBlockEnd: 8 }}>
                    Templates
                  </Typography>
                  <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))' }}>
                    {TEMPLATES.map(t => (
                      <button
                        key={t.key}
                        type='button'
                        disabled={atLimit}
                        onClick={() => setEditing(formFromRule(t.make()))}
                        style={{
                          textAlign: 'start',
                          padding: 14,
                          borderRadius: 10,
                          border: '1px solid var(--vhyx-color-border)',
                          background: 'var(--vhyx-color-surface)',
                          color: 'var(--vhyx-color-text)',
                          cursor: atLimit ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                        <div style={{ ...muted, fontSize: 13, marginBlockStart: 4 }}>{t.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <TestPanel accountId={accountId} label={label} rules={rules} live={o.liveLabels.includes(label)} />
            </>
          )}
        </>
      )}

      {editing && (
        <RuleDialog
          form={editing}
          isNew={!rules.some(r => r.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={rule => {
            const exists = rules.some(r => r.id === rule.id)

            change(exists ? rules.map(r => (r.id === rule.id ? rule : r)) : [...rules, rule])
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function RuleDialog({ form, isNew, onClose, onSave }: { form: RuleForm; isNew: boolean; onClose: () => void; onSave: (r: TrafficRule) => void }) {
  const [f, setF] = useState<RuleForm>(form)
  const set = (p: Partial<RuleForm>) => setF(prev => ({ ...prev, ...p }))
  const info = ACTION_INFO[f.type]
  const pathOk = f.path.trim() === '*' || f.path.trim().startsWith('/')

  return (
    <Dialog open onOpenChange={next => !next && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{isNew ? 'New rule' : `Edit “${form.name}”`}</Dialog.Title>
          <div className='flex flex-col gap-4'>
            <SelectField
              name='type'
              label='What it does'
              value={f.type}
              onValueChange={v => {
                const b = blankForm(v as RuleForm['type'])

                set({ type: b.type, status: b.status, name: f.name === ACTION_INFO[f.type].title ? b.name : f.name })
              }}
              options={(Object.keys(ACTION_INFO) as RuleForm['type'][]).map(t => ({ value: t, label: ACTION_INFO[t].title }))}
              hint={info.help}
            />
            <TextField name='name' label='Name' value={f.name} maxLength={80} onChange={e => set({ name: e.target.value })} />

            <Typography variant='subtitle2'>Which requests</Typography>
            <TextField
              name='path'
              label='Path'
              value={f.path}
              onChange={e => set({ path: e.target.value })}
              hint='/exact/path, /prefix/* or * for every path. * matches anything. The query string is ignored.'
              error={pathOk ? undefined : 'Start with / or use *'}
            />
            <div className='flex flex-wrap gap-2' role='group' aria-label='Methods'>
              {METHODS.map(m => {
                const on = f.methods.includes(m)

                return (
                  <Button key={m} size='sm' type='button' variant={on ? 'secondary' : 'ghost'} aria-pressed={on} onClick={() => set({ methods: on ? f.methods.filter(x => x !== m) : [...f.methods, m] })}>
                    {m}
                  </Button>
                )
              })}
              <Typography variant='caption' style={{ ...muted, alignSelf: 'center' }}>
                {f.methods.length ? '' : 'none selected = any method'}
              </Typography>
            </div>
            <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
              <TextField name='headerName' label='Only with header (optional)' placeholder='X-Mock' value={f.headerName} onChange={e => set({ headerName: e.target.value })} />
              <TextField name='headerValue' label='Equal to (optional)' value={f.headerValue} onChange={e => set({ headerValue: e.target.value })} disabled={!f.headerName.trim()} />
            </div>
            {info.answers && (
              <label className='flex items-center gap-2'>
                <Switch checked={f.when === 'offline'} onCheckedChange={(v: boolean) => set({ when: v ? 'offline' : 'always' })} aria-label='Only while the agent is offline' />
                <Typography variant='body2'>Only while the agent is offline</Typography>
              </label>
            )}

            <Typography variant='subtitle2'>{info.title}</Typography>
            {(f.type === 'mock' || f.type === 'fail' || f.type === 'redirect') && (
              <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
                {f.type === 'redirect' ? (
                  <SelectField name='status' label='Status' value={f.status} onValueChange={v => set({ status: v })} options={['301', '302', '307', '308'].map(s => ({ value: s, label: s }))} />
                ) : (
                  <TextField name='status' type='number' label='Status' min={f.type === 'fail' ? 400 : 200} max={599} value={f.status} onChange={e => set({ status: e.target.value })} />
                )}
                {f.type === 'fail' && <TextField name='percent' type='number' label='Share of requests (%)' min={1} max={100} value={f.percent} onChange={e => set({ percent: e.target.value })} />}
              </div>
            )}
            {f.type === 'redirect' && (
              <TextField name='location' label='Location' placeholder='https://staging.example.com{path}' value={f.location} onChange={e => set({ location: e.target.value })} hint='A path (/…) or an http(s) URL. {path} is replaced by the original path and query.' />
            )}
            {(f.type === 'mock' || f.type === 'requestHeaders' || f.type === 'responseHeaders') && (
              <TextareaField
                name='headers'
                label={f.type === 'mock' ? 'Headers' : 'Set headers'}
                rows={3}
                value={f.headers}
                onChange={e => set({ headers: e.target.value })}
                hint='One per line: Name: value'
                style={mono}
              />
            )}
            {(f.type === 'requestHeaders' || f.type === 'responseHeaders') && (
              <TextareaField name='remove' label='Remove headers' rows={2} value={f.remove} onChange={e => set({ remove: e.target.value })} hint='Header names, one per line' style={mono} />
            )}
            {(f.type === 'mock' || f.type === 'fail') && (
              <TextareaField name='body' label='Body' rows={f.type === 'mock' ? 8 : 2} value={f.body} onChange={e => set({ body: e.target.value })} hint={f.type === 'mock' ? 'Up to 64 KB of text' : 'Optional; a short text by default'} style={mono} />
            )}
            {f.type === 'delay' && <TextField name='ms' type='number' label='Milliseconds' min={1} max={30000} value={f.ms} onChange={e => set({ ms: e.target.value })} hint='Up to 30 000 ms; several delay rules add up.' />}
            {f.type === 'rewrite' && <TextField name='to' label='Forward to path' value={f.to} onChange={e => set({ to: e.target.value })} hint='With /old/* → /new, /old/a/b goes to /new/a/b. The query string is kept.' />}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onSave(ruleFromForm(f))} disabled={!f.name.trim() || !pathOk}>
              {isNew ? 'Add to list' : 'Update'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function TestPanel({ accountId, label, rules, live }: { accountId: string; label: string; rules: TrafficRule[]; live: boolean }) {
  const [method, setMethod] = useState<RuleMethod>('GET')
  const [path, setPath] = useState('/')
  const [offline, setOffline] = useState(!live)
  const [result, setResult] = useState<RulePlan | null>(null)

  const test = useMutation({
    mutationFn: () => trafficRulesService.test(accountId, label, { method, path: path.startsWith('/') ? path : `/${path}`, online: !offline }, rules),
    onSuccess: setResult,
    onError: e => toast.danger((e as Error).message)
  })

  const name = (id: string) => rules.find(r => r.id === id)?.name ?? id

  return (
    <Card>
      <Typography variant='subtitle1'>Test a request</Typography>
      <Typography variant='body2' style={{ ...muted, marginBlockEnd: 12 }}>
        See what the rules on screen (saved or not) do with a request. Nothing is sent to your app.
      </Typography>
      <form
        className='flex flex-wrap items-end gap-3'
        onSubmit={e => {
          e.preventDefault()
          test.mutate()
        }}
      >
        <div style={{ inlineSize: 130 }}>
          <SelectField name='method' label='Method' value={method} onValueChange={v => setMethod(v as RuleMethod)} options={METHODS.map(m => ({ value: m, label: m }))} />
        </div>
        <div style={{ flex: 1, minInlineSize: 200 }}>
          <TextField name='testPath' label='Path' value={path} onChange={e => setPath(e.target.value)} placeholder='/api/users?page=2' />
        </div>
        <label className='flex items-center gap-2' style={{ paddingBlockEnd: 8 }}>
          <Switch checked={offline} onCheckedChange={setOffline} aria-label='Agent offline' />
          <Typography variant='body2'>Agent offline</Typography>
        </label>
        <Button type='submit' loading={test.isPending}>
          Test
        </Button>
      </form>

      {result && (
        <div className='mbs-4 flex flex-col gap-2' role='status'>
          {result.respond ? (
            <Alert variant='warning' title={`Answered by “${name(result.respond.ruleId)}”: ${result.respond.status}`}>
              {result.respond.kind === 'redirect' ? `Redirects to ${result.respond.headers.location}` : 'Your app does not see this request.'}
              {result.respond.body ? (
                <pre style={{ ...mono, whiteSpace: 'pre-wrap', marginBlockStart: 8, maxBlockSize: 160, overflow: 'auto' }}>{result.respond.body.slice(0, 2000)}</pre>
              ) : null}
            </Alert>
          ) : (
            <Alert variant={offline ? 'danger' : 'success'} title={offline ? 'No rule answers: the caller gets “tunnel offline” (or the webhook inbox keeps it)' : 'Forwarded to your app'}>
              <span style={mono}>
                {method} {result.path}
              </span>
              {result.delayMs ? ` after ${result.delayMs} ms` : ''}
            </Alert>
          )}
          {(Object.keys(result.setRequestHeaders).length > 0 || result.removeRequestHeaders.length > 0) && (
            <Typography variant='body2'>
              Request headers: {[...Object.entries(result.setRequestHeaders).map(([k, v]) => `${k}: ${v}`), ...result.removeRequestHeaders.map(k => `−${k}`)].join(', ')}
            </Typography>
          )}
          {(Object.keys(result.setResponseHeaders).length > 0 || result.removeResponseHeaders.length > 0) && (
            <Typography variant='body2'>
              Response headers: {[...Object.entries(result.setResponseHeaders).map(([k, v]) => `${k}: ${v}`), ...result.removeResponseHeaders.map(k => `−${k}`)].join(', ')}
            </Typography>
          )}
          <Typography variant='caption' style={muted}>
            Rules involved: {result.matched.length ? result.matched.map(name).join(' → ') : 'none'}
          </Typography>
        </div>
      )}
    </Card>
  )
}
