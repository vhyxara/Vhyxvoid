'use client'

import { useEffect, useMemo, useState } from 'react'

import Link from 'next/link'

import { PageHeader, SettingsSection } from '@vhyxui/blocks'
import { Alert, Badge, Button, Input, SelectField, Skeleton, Switch, Text, TextareaField, toast } from '@vhyxui/react'

import { platformKeys, useSettings } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { SettingView } from '@/api/platform/types'
import { formatDate } from '@/components/ui/format'
import { useQueryClient } from '@tanstack/react-query'

// Edited on the Plans & pricing page instead.
const PLANS_PAGE_GROUPS = new Set(['billing', 'plans'])

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

/** Fallback editor for json settings that have no dedicated screen. */
function JsonSetting({ s, onSave }: { s: SettingView; onSave: (v: unknown) => Promise<unknown> }) {
  const [text, setText] = useState(() => JSON.stringify(s.value ?? null, null, 2))
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className='flex flex-col gap-2'>
      <Text weight='medium'>{s.label}</Text>
      <Text size='sm' tone='muted'>
        {s.description}
      </Text>
      <TextareaField name={s.key} label='JSON' rows={6} value={text} onChange={e => setText(e.target.value)} error={err ?? undefined} />
      <div>
        <Button
          size='sm'
          onClick={() => {
            try {
              setErr(null)
              onSave(JSON.parse(text)).catch(() => {})
            } catch {
              setErr('Not valid JSON')
            }
          }}
        >
          Save
        </Button>
      </div>
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save')
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

      <Alert variant='info' title='Billing, pricing and plan limits'>
        Free or paid mode, the default plan, plan limits and Stripe prices are on{' '}
        <Link href='/plans'>Plans &amp; pricing</Link>.
      </Alert>

      {Object.entries(byGroup).filter(([group]) => !PLANS_PAGE_GROUPS.has(group)).map(([group, settings]) => (
        <SettingsSection key={group} title={data.groups[group]?.label ?? group} description={data.groups[group]?.description}>
          <div className='flex flex-col gap-5'>
            {settings.map(s =>
              s.type === 'json' ? (
                <JsonSetting key={s.key} s={s} onSave={v => save({ [s.key]: v })} />
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
