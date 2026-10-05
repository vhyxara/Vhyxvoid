'use client'

import { useEffect, useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import { PageHeader, SettingsSection } from '@vhyxui/blocks'
import { Alert, Badge, Button, Input, SelectField, Skeleton, Switch, Table, Tabs, Text, TextareaField, toast } from '@vhyxui/react'

import { platformKeys, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SettingView } from '@/api/platform/types'
import { formatDate, formatLimit } from '@/components/ui/format'
import { LimitOverridesEditor } from '@/views/accounts/LimitOverridesEditor'
import { useQueryClient } from '@tanstack/react-query'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function SettingInput({ s, value, onChange }: { s: SettingView; value: unknown; onChange: (v: unknown) => void }) {
  switch (s.type) {
    case 'boolean':
      return <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={s.label} />
    case 'number':
      return (
        <Input
          type='number'
          aria-label={s.label}
          min={s.min}
          max={s.max}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          size='sm'
          style={{ maxInlineSize: 140 }}
        />
      )
    case 'enum':
      return <SelectField name={s.key} label={s.label} size='sm' value={String(value)} onValueChange={onChange} options={(s.options ?? []).map(o => ({ value: o, label: o }))} />
    case 'text':
      return <TextareaField name={s.key} label={s.label} rows={3} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />
    case 'stringList':
      return (
        <TextareaField
          name={s.key}
          label={s.label}
          hint='One per line.'
          rows={3}
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={e => onChange(e.target.value.split('\n').map(v => v.trim()).filter(Boolean))}
        />
      )
    default:
      return <Input aria-label={s.label} type={s.type === 'email' ? 'email' : s.type === 'url' ? 'url' : 'text'} value={String(value ?? '')} maxLength={s.maxLength} onChange={e => onChange(e.target.value)} size='sm' />
  }
}

function PlanOverrides({ value, onSave }: { value: Record<string, any>; onSave: (v: Record<string, any> | null) => Promise<unknown> }) {
  const limits = useQuery({ queryKey: platformKeys.area('plan-limits'), queryFn: platformService.planLimits })
  const plans = ['FREE', 'PRO', 'ENTERPRISE']
  const builtIn = limits.data?.builtIn ?? {}
  const rows = Object.keys(builtIn.FREE ?? {}).map(k => ({ id: k, k, FREE: builtIn.FREE?.[k], PRO: builtIn.PRO?.[k], ENTERPRISE: builtIn.ENTERPRISE?.[k], how: limits.data?.enforcement?.[k] ?? '' }))

  return (
    <div className='flex flex-col gap-4'>
      <Alert variant='info'>
        Overrides change what every account on a plan gets, within a minute, without a deploy. Prices are set in Stripe and on the pricing page
        (Website content). Per-account exceptions are on each account&apos;s page.
      </Alert>
      <Tabs defaultValue='FREE' variant='pills'>
        <Tabs.List>
          {plans.map(p => (
            <Tabs.Trigger key={p} value={p}>
              {p} {value?.[p] && Object.keys(value[p]).length ? <Badge size='sm' variant='info'>overridden</Badge> : null}
            </Tabs.Trigger>
          ))}
          <Tabs.Trigger value='reference'>Built-in limits</Tabs.Trigger>
        </Tabs.List>
        {plans.map(p => (
          <Tabs.Content key={p} value={p}>
            <LimitOverridesEditor
              value={value?.[p] ?? null}
              onSave={next => {
                const all = { ...(value ?? {}) }

                if (next) all[p] = next
                else delete all[p]

                return onSave(Object.keys(all).length ? all : null)
              }}
            />
          </Tabs.Content>
        ))}
        <Tabs.Content value='reference'>
          <div style={{ overflowX: 'auto' }}>
            <Table
              density='compact'
              data={rows as any}
              columns={[
                { key: 'k', header: 'Limit', cell: (r: any) => <code>{r.k}</code> },
                ...plans.map(p => ({ key: p, header: p, cell: (r: any) => formatLimit(r[p]) })),
                { key: 'how', header: 'Enforced', cell: (r: any) => <Text size='xs'>{r.how}</Text> }
              ]}
            />
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export function SettingsView() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useSettings()
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => setDraft({}), [data])

  const byGroup = useMemo(() => {
    const out: Record<string, SettingView[]> = {}

    for (const s of data?.settings ?? []) (out[s.group] ??= []).push(s)

    return out
  }, [data])

  const changed = Object.keys(draft).filter(k => {
    const s = data?.settings.find(x => x.key === k)

    return s && !same(s.value, draft[k])
  })

  const save = async (changes: Record<string, unknown>) => {
    setSaving(true)
    setSaveError(null)
    try {
      const fresh = await platformService.updateSettings(changes)

      qc.setQueryData(platformKeys.area('settings'), fresh)
      await qc.invalidateQueries({ queryKey: platformKeys.area('plan-limits') })
      toast.success('Settings saved')
    } catch (e: any) {
      setSaveError(e?.message ?? 'Could not save')
      throw e
    } finally {
      setSaving(false)
    }
  }

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>
  if (isLoading || !data) return <Skeleton height='24rem' />

  const maintenanceOn = data.settings.find(s => s.key === 'maintenance.enabled')?.value === true

  return (
    <div className='flex flex-col gap-6' style={{ paddingBlockEnd: changed.length ? 80 : 0 }}>
      <PageHeader title='Settings' description='Change how the product behaves, without a deploy. Every change is recorded in the admin audit log.' />
      {maintenanceOn && (
        <Alert variant='warning' title='Maintenance mode is on'>
          Users see the maintenance page and the user API answers 503.
        </Alert>
      )}

      {Object.entries(byGroup).map(([group, settings]) => (
        <SettingsSection key={group} title={data.groups[group]?.label ?? group} description={data.groups[group]?.description}>
          <div className='flex flex-col gap-5'>
            {settings.map(s =>
              s.key === 'plans.overrides' ? (
                <PlanOverrides key={s.key} value={(s.value as Record<string, any>) ?? {}} onSave={v => save({ [s.key]: v })} />
              ) : (
                <div key={s.key} className='grid gap-3' style={{ gridTemplateColumns: 'minmax(12rem, 1fr) minmax(14rem, 1.4fr)' }}>
                  <div>
                    <Text weight='medium'>
                      {s.label} {s.public ? null : <Badge size='sm' variant='outline'>private</Badge>}
                    </Text>
                    <Text size='sm' tone='muted'>
                      {s.description}
                    </Text>
                    <Text size='xs' tone='muted'>
                      <code>{s.key}</code>
                      {s.updatedAt ? ` · changed ${formatDate(s.updatedAt)}` : ' · default'}
                    </Text>
                  </div>
                  <div className='flex flex-col gap-1 items-start'>
                    <SettingInput s={s} value={s.key in draft ? draft[s.key] : s.value} onChange={v => setDraft(d => ({ ...d, [s.key]: v }))} />
                    {!s.isDefault && (
                      <Button size='xs' variant='link' onClick={() => save({ [s.key]: null }).catch(() => {})}>
                        Reset to default
                      </Button>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </SettingsSection>
      ))}

      {changed.length > 0 && (
        <div
          className='flex flex-wrap items-center justify-between gap-3 p-3'
          style={{ position: 'fixed', insetInline: 16, insetBlockEnd: 16, zIndex: 20, background: 'var(--vhyx-color-surface, #fff)', border: '1px solid var(--vhyx-color-border, #ddd)', borderRadius: 12, boxShadow: '0 8px 24px rgb(0 0 0 / .12)' }}
        >
          <Text>
            {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
          </Text>
          {saveError && <Text tone='danger' size='sm'>{saveError}</Text>}
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={() => setDraft({})}>
              Discard
            </Button>
            <Button loading={saving} onClick={() => save(Object.fromEntries(changed.map(k => [k, draft[k]]))).catch(() => {})}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
