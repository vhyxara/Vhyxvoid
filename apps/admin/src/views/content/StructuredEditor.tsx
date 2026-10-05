'use client'

import { Button, Input, Switch, Text, Textarea } from '@vhyxui/react'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const LONG_KEYS = /^(body|subtitle|description|a|source)$/

const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())

/** An empty value shaped like `sample` (for "Add item"). */
function blankLike(sample: Json): Json {
  if (Array.isArray(sample)) return []
  if (sample && typeof sample === 'object') return Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, blankLike(v)]))
  if (typeof sample === 'boolean') return false
  if (typeof sample === 'number') return 0

  return ''
}

/**
 * Renders any JSON content as a form: objects become field groups, arrays
 * become repeatable items (add / remove / move), strings text inputs (long
 * ones textareas), booleans switches. Content schemas live in the API
 * (content.schemas.ts), which validates on save.
 */
export function StructuredEditor({ value, onChange, path = [] }: { value: Json; onChange: (v: Json) => void; path?: string[] }) {
  const label = path.length ? humanize(path[path.length - 1]) : ''

  if (Array.isArray(value)) {
    const sample = value[0] ?? ''
    const move = (from: number, to: number) => {
      if (to < 0 || to >= value.length) return
      const next = [...value]
      const [item] = next.splice(from, 1)

      next.splice(to, 0, item)
      onChange(next)
    }

    return (
      <fieldset className='flex flex-col gap-3' style={{ border: '1px dashed var(--vhyx-color-border, #ccc)', borderRadius: 8, padding: 12, margin: 0 }}>
        {label && (
          <legend>
            <Text size='sm' weight='medium'>
              {label} ({value.length})
            </Text>
          </legend>
        )}
        {value.map((item, i) => (
          <div key={i} className='flex flex-col gap-2' style={{ borderInlineStart: '3px solid var(--vhyx-color-border, #ddd)', paddingInlineStart: 10 }}>
            <div className='flex items-center justify-between gap-2'>
              <Text size='xs' tone='muted'>
                #{i + 1}
              </Text>
              <div className='flex gap-1'>
                <Button size='xs' variant='ghost' aria-label='Move up' disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </Button>
                <Button size='xs' variant='ghost' aria-label='Move down' disabled={i === value.length - 1} onClick={() => move(i, i + 1)}>
                  ↓
                </Button>
                <Button size='xs' variant='ghost' onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>
            <StructuredEditor value={item} onChange={v => onChange(value.map((x, j) => (j === i ? v : x)))} path={[...path, String(i)]} />
          </div>
        ))}
        <div>
          <Button size='xs' variant='outline' onClick={() => onChange([...value, blankLike(sample)])}>
            Add {label ? label.replace(/s$/, '').toLowerCase() : 'item'}
          </Button>
        </div>
      </fieldset>
    )
  }

  if (value && typeof value === 'object') {
    return (
      <div className='flex flex-col gap-3'>
        {Object.entries(value).map(([k, v]) => {
          const child = <StructuredEditor key={k} value={v} onChange={nv => onChange({ ...value, [k]: nv })} path={[...path, k]} />

          return v && typeof v === 'object' && !Array.isArray(v) ? (
            <fieldset key={k} style={{ border: '1px solid var(--vhyx-color-border, #ddd)', borderRadius: 8, padding: 12, margin: 0 }}>
              <legend>
                <Text size='sm' weight='medium'>
                  {humanize(k)}
                </Text>
              </legend>
              {child}
            </fieldset>
          ) : (
            child
          )
        })}
      </div>
    )
  }

  const id = `f-${path.join('-')}`

  if (typeof value === 'boolean') {
    return (
      <label htmlFor={id} className='flex items-center gap-2'>
        <Switch id={id} checked={value} onCheckedChange={onChange} />
        <Text size='sm'>{label}</Text>
      </label>
    )
  }

  const str = value === null || value === undefined ? '' : String(value)
  const long = LONG_KEYS.test(path[path.length - 1] ?? '') || str.length > 80 || str.includes('\n')

  return (
    <label htmlFor={id} className='flex flex-col gap-1'>
      {label && !/^\d+$/.test(path[path.length - 1] ?? '') && <Text size='sm'>{label}</Text>}
      {long ? (
        <Textarea id={id} rows={Math.min(14, Math.max(3, str.split('\n').length + 1))} value={str} onChange={e => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={str} onChange={e => onChange(typeof value === 'number' ? Number(e.target.value) : e.target.value)} size='sm' />
      )}
    </label>
  )
}
