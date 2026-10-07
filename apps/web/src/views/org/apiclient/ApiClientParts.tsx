'use client'

// Building blocks of the API client: key/value tables, auth, body, checks,
// captures, the response viewer, and the dialogs (environments, code,
// collection settings, run report, import into a collection).

import { useEffect, useMemo, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Badge, Button, Card, Checkbox, Dialog, Input, SelectField, Skeleton, Switch, Tabs, Textarea, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import {
  apiClientService,
  type ApiAssertion,
  type ApiAuth,
  type ApiBody,
  type ApiCapture,
  type ApiRequest,
  type ApiResponse,
  type ApiVariable,
  type AssertionResult,
  type CaptureResult,
  type EnvVariable,
  type Environment,
  type KeyValue,
  type MultipartField,
  type ParsedDocument,
  type RunReport,
  type RunResult,
  type SendContext,
  type SentRequest,
  type SnippetLanguage
} from '@/api/infrastructure/services/apiClient.service'
import {
  ASSERTION_OPS,
  ASSERTION_SOURCES,
  AUTH_TYPES,
  BODY_TYPES,
  DYNAMIC_VARS,
  VAR_NAME_RE,
  bodyView,
  convertBody,
  fileToBase64,
  formatBytes,
  formatJson,
  formatMs,
  jsonProblem,
  newAssertion,
  newAuth,
  newCapture,
  opsFor,
  statusVariant,
  timingSegments
} from './apiClientForm'

export const muted = { color: 'var(--vhyx-color-text-muted)' } as const
export const mono = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 } as const

export function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

const iconBtn = { background: 'none', border: 0, padding: 4, cursor: 'pointer', color: 'var(--vhyx-color-text-muted)', borderRadius: 6 } as const

function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type='button' aria-label={label} title={label} onClick={onClick} disabled={disabled} style={{ ...iconBtn, opacity: disabled ? 0.4 : 1 }}>
      <i className={icon} aria-hidden />
    </button>
  )
}

// ── Key / value table ────────────────────────────────────────────────────────

export function KeyValueEditor({ rows, onChange, keyLabel = 'Key', valueLabel = 'Value', disabled, suggestions }: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; keyLabel?: string; valueLabel?: string; disabled?: boolean; suggestions?: string[] }) {
  const listId = useMemo(() => `kv-${Math.random().toString(36).slice(2, 8)}`, [])
  // An empty row at the end is always there to type into.
  const shown = [...rows, { key: '', value: '', enabled: true }]

  const set = (i: number, patch: Partial<KeyValue>) => {
    const next = shown.map((r, j) => (j === i ? { ...r, ...patch } : r))

    onChange(next.filter((r, j) => j < rows.length || r.key || r.value))
  }

  return (
    <div className='flex flex-col gap-1' role='table' aria-label={`${keyLabel}s`}>
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {shown.map((r, i) => {
        const placeholder = i === rows.length

        return (
          <div key={i} role='row' className='grid items-center gap-2' style={{ gridTemplateColumns: '1.5rem minmax(0, 1fr) minmax(0, 1.4fr) 1.75rem' }}>
            {placeholder ? <span /> : <Checkbox checked={r.enabled} disabled={disabled} onCheckedChange={v => set(i, { enabled: v === true })} aria-label={`Use ${r.key || 'this row'}`} />}
            <Input size='sm' aria-label={keyLabel} placeholder={keyLabel} value={r.key} disabled={disabled} list={suggestions ? listId : undefined} onChange={e => set(i, { key: e.target.value })} style={mono} />
            <Input size='sm' aria-label={valueLabel} placeholder={valueLabel} value={r.value} disabled={disabled} onChange={e => set(i, { value: e.target.value })} style={mono} />
            {placeholder ? <span /> : <IconButton icon='tabler-x' label={`Remove ${r.key || 'row'}`} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))} />}
          </div>
        )
      })}
    </div>
  )
}

export const COMMON_HEADERS = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'Cookie', 'If-None-Match', 'Idempotency-Key', 'Origin', 'User-Agent', 'X-Request-Id', 'X-Api-Key']

// ── Auth ─────────────────────────────────────────────────────────────────────

export function AuthEditor({ auth, onChange, allowInherit = true, inheritedLabel }: { auth: ApiAuth; onChange: (a: ApiAuth) => void; allowInherit?: boolean; inheritedLabel?: string }) {
  const types = AUTH_TYPES.filter(t => allowInherit || t.value !== 'inherit')

  return (
    <div className='flex flex-col gap-3'>
      <div style={{ maxInlineSize: '18rem' }}>
        <SelectField name='auth-type' label='Type' value={auth.type} onValueChange={v => onChange(newAuth(v as ApiAuth['type']))} options={types.map(t => ({ value: t.value, label: t.label }))} />
      </div>
      {auth.type === 'inherit' && (
        <Typography variant='body2' style={muted}>
          Uses the collection&apos;s auth{inheritedLabel ? `: ${inheritedLabel}` : ''}. Change it in the collection settings.
        </Typography>
      )}
      {auth.type === 'none' && (
        <Typography variant='body2' style={muted}>
          No Authorization is added.
        </Typography>
      )}
      {auth.type === 'bearer' && <TextField name='token' label='Token' value={auth.token} onChange={e => onChange({ ...auth, token: e.target.value })} hint='Sent as Authorization: Bearer …. Use {{token}} and keep the value in an environment as a secret.' style={mono} />}
      {auth.type === 'basic' && (
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
          <TextField name='username' label='Username' value={auth.username} onChange={e => onChange({ ...auth, username: e.target.value })} />
          <TextField name='password' label='Password' type='password' value={auth.password} onChange={e => onChange({ ...auth, password: e.target.value })} />
        </div>
      )}
      {auth.type === 'apiKey' && (
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
          <TextField name='key-name' label='Name' value={auth.name} onChange={e => onChange({ ...auth, name: e.target.value })} style={mono} />
          <TextField name='key-value' label='Value' value={auth.value} onChange={e => onChange({ ...auth, value: e.target.value })} style={mono} />
          <SelectField name='key-in' label='Send in' value={auth.in} onValueChange={v => onChange({ ...auth, in: v as 'header' | 'query' })} options={[{ value: 'header', label: 'Header' }, { value: 'query', label: 'Query string' }]} />
        </div>
      )}
      {auth.type === 'hmac' && (
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
          <TextField name='hmac-secret' label='Secret' value={auth.secret} onChange={e => onChange({ ...auth, secret: e.target.value })} style={mono} />
          <SelectField name='hmac-alg' label='Algorithm' value={auth.algorithm} onValueChange={v => onChange({ ...auth, algorithm: v as 'sha256' })} options={['sha256', 'sha1', 'sha512'].map(a => ({ value: a, label: a.toUpperCase() }))} />
          <SelectField name='hmac-enc' label='Encoding' value={auth.encoding} onValueChange={v => onChange({ ...auth, encoding: v as 'hex' })} options={[{ value: 'hex', label: 'Hex' }, { value: 'base64', label: 'Base64' }]} />
          <TextField name='hmac-header' label='Signature header' value={auth.header} onChange={e => onChange({ ...auth, header: e.target.value })} style={mono} />
          <TextField name='hmac-prefix' label='Prefix' value={auth.prefix ?? ''} onChange={e => onChange({ ...auth, prefix: e.target.value })} placeholder='sha256=' style={mono} />
          <TextField name='hmac-ts' label='Timestamp header (optional)' value={auth.timestampHeader ?? ''} onChange={e => onChange({ ...auth, timestampHeader: e.target.value || undefined })} placeholder='X-Timestamp' hint='Signs "<unix time>.<body>" when set' style={mono} />
        </div>
      )}
    </div>
  )
}

export function authSummary(a: ApiAuth): string {
  switch (a.type) {
    case 'bearer':
      return 'Bearer token'
    case 'basic':
      return `Basic (${a.username || 'no username'})`
    case 'apiKey':
      return `API key ${a.name} in the ${a.in === 'query' ? 'query string' : 'header'}`
    case 'hmac':
      return `HMAC ${a.algorithm} in ${a.header}`
    default:
      return 'no auth'
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

export function BodyEditor({ body, onChange }: { body: ApiBody; onChange: (b: ApiBody) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const problem = body.type === 'json' ? jsonProblem(body.text) : null

  const pickFile = async (f: File): Promise<{ name: string; contentType: string; base64: string } | null> => {
    if (f.size > 5_000_000) {
      toast.danger('Files can be up to 5 MB')

      return null
    }

    return { name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileToBase64(f) }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap gap-1' role='radiogroup' aria-label='Body type'>
        {BODY_TYPES.map(t => (
          <button
            key={t.value}
            type='button'
            role='radio'
            aria-checked={body.type === t.value}
            onClick={() => onChange(convertBody(body, t.value))}
            style={{ padding: '4px 10px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: '1px solid var(--vhyx-color-border)', color: 'inherit', background: body.type === t.value ? 'var(--vhyx-color-bg-muted)' : 'transparent', fontWeight: body.type === t.value ? 600 : 400 }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {body.type === 'none' && (
        <Typography variant='body2' style={muted}>
          This request has no body.
        </Typography>
      )}
      {(body.type === 'json' || body.type === 'raw') && (
        <>
          <Textarea aria-label='Body' rows={12} value={body.text} onChange={e => onChange({ ...body, text: e.target.value })} spellCheck={false} style={{ ...mono, resize: 'vertical' }} />
          <div className='flex flex-wrap items-center gap-2 justify-between'>
            {body.type === 'json' ? (
              <Typography variant='caption' style={{ color: problem ? 'var(--vhyx-color-danger)' : 'var(--vhyx-color-text-muted)' }}>
                {problem ? `Not valid JSON: ${problem}` : 'Variables like {{id}} and {{$uuid}} work here.'}
              </Typography>
            ) : (
              <div style={{ minInlineSize: '14rem' }}>
                <TextField name='ct' label='Content-Type' size='sm' value={body.contentType} onChange={e => onChange({ ...body, contentType: e.target.value })} style={mono} />
              </div>
            )}
            {body.type === 'json' && (
              <Button size='sm' variant='ghost' onClick={() => onChange({ ...body, text: formatJson(body.text) })} disabled={!!problem}>
                Format
              </Button>
            )}
          </div>
        </>
      )}
      {body.type === 'graphql' && (
        <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))' }}>
          <label className='flex flex-col gap-1'>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Query</span>
            <Textarea aria-label='GraphQL query' rows={10} value={body.query} onChange={e => onChange({ ...body, query: e.target.value })} spellCheck={false} style={mono} />
          </label>
          <label className='flex flex-col gap-1'>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Variables (JSON)</span>
            <Textarea aria-label='GraphQL variables' rows={10} value={body.variables} onChange={e => onChange({ ...body, variables: e.target.value })} spellCheck={false} style={mono} />
          </label>
        </div>
      )}
      {body.type === 'form' && <KeyValueEditor rows={body.fields} onChange={fields => onChange({ ...body, fields })} keyLabel='Field' />}
      {body.type === 'multipart' && <MultipartEditor fields={body.fields} onChange={fields => onChange({ ...body, fields })} pickFile={pickFile} />}
      {body.type === 'file' && (
        <div className='flex flex-wrap items-center gap-3'>
          <input
            ref={fileRef}
            type='file'
            hidden
            onChange={async e => {
              const f = e.target.files?.[0]
              const picked = f ? await pickFile(f) : null

              if (picked) onChange({ type: 'file', ...picked })
            }}
          />
          <Button size='sm' variant='outline' icon={<i className='tabler-upload' />} onClick={() => fileRef.current?.click()}>
            {body.name ? 'Replace file' : 'Choose a file'}
          </Button>
          {body.name && (
            <span style={mono}>
              {body.name} · {formatBytes(Math.floor((body.base64.length * 3) / 4))} · {body.contentType}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function MultipartEditor({ fields, onChange, pickFile }: { fields: MultipartField[]; onChange: (f: MultipartField[]) => void; pickFile: (f: File) => Promise<MultipartField['file'] | null> }) {
  const set = (i: number, patch: Partial<MultipartField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  return (
    <div className='flex flex-col gap-2'>
      {fields.map((f, i) => (
        <div key={i} className='grid items-center gap-2' style={{ gridTemplateColumns: '1.5rem minmax(0, 1fr) minmax(0, 1.4fr) 1.75rem' }}>
          <Checkbox checked={f.enabled} onCheckedChange={v => set(i, { enabled: v === true })} aria-label={`Use ${f.key || 'field'}`} />
          <Input size='sm' aria-label='Field' placeholder='Field' value={f.key} onChange={e => set(i, { key: e.target.value })} style={mono} />
          {f.file ? (
            <label className='flex items-center gap-2' style={{ ...mono, cursor: 'pointer', minInlineSize: 0 }}>
              <i className='tabler-paperclip' aria-hidden />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.base64 ? `${f.file.name} (${formatBytes(Math.floor((f.file.base64.length * 3) / 4))})` : `choose ${f.file.name}`}</span>
              <input
                type='file'
                hidden
                onChange={async e => {
                  const file = e.target.files?.[0]
                  const picked = file ? await pickFile(file) : null

                  if (picked) set(i, { file: picked })
                }}
              />
            </label>
          ) : (
            <Input size='sm' aria-label='Value' placeholder='Value' value={f.value} onChange={e => set(i, { value: e.target.value })} style={mono} />
          )}
          <IconButton icon='tabler-x' label='Remove field' onClick={() => onChange(fields.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className='flex gap-2'>
        <Button size='sm' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => onChange([...fields, { key: '', value: '', enabled: true }])}>
          Text field
        </Button>
        <label>
          <span className='vhyx-btn' style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--vhyx-color-border)' }}>
            <i className='tabler-paperclip' aria-hidden /> File field
          </span>
          <input
            type='file'
            hidden
            onChange={async e => {
              const file = e.target.files?.[0]
              const picked = file ? await pickFile(file) : null

              if (picked) onChange([...fields, { key: 'file', value: '', enabled: true, file: picked }])
            }}
          />
        </label>
      </div>
    </div>
  )
}

// ── Checks and captures ──────────────────────────────────────────────────────

export function ChecksEditor({ list, onChange, results }: { list: ApiAssertion[]; onChange: (l: ApiAssertion[]) => void; results?: AssertionResult[] }) {
  const set = (i: number, patch: Partial<ApiAssertion>) => onChange(list.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const byId = new Map((results ?? []).map(r => [r.id, r]))

  return (
    <div className='flex flex-col gap-2'>
      {list.length === 0 && (
        <Typography variant='body2' style={muted}>
          No checks yet. Add one, or send the request and use &quot;Suggest checks&quot;.
        </Typography>
      )}
      {list.map((a, i) => {
        const op = ASSERTION_OPS.find(o => o.value === a.op)
        const r = byId.get(a.id)

        return (
          <div key={a.id} className='flex flex-col gap-1' style={{ padding: 8, borderRadius: 8, border: '1px solid var(--vhyx-color-border)', opacity: a.enabled ? 1 : 0.55 }}>
            <div className='grid items-end gap-2' style={{ gridTemplateColumns: 'auto minmax(7rem, 0.9fr) minmax(0, 1fr) minmax(7rem, 0.9fr) minmax(0, 1.2fr) auto' }}>
              <div style={{ paddingBlockEnd: 6 }}>
                <Checkbox checked={a.enabled} onCheckedChange={v => set(i, { enabled: v === true })} aria-label='Use this check' />
              </div>
              <SelectField
                name={`src-${a.id}`}
                size='sm'
                value={a.source}
                onValueChange={v => {
                  const source = v as ApiAssertion['source']
                  const fresh = newAssertion(source)

                  set(i, { source, op: fresh.op, path: fresh.path, value: fresh.value })
                }}
                options={ASSERTION_SOURCES.map(s => ({ value: s.value, label: s.label }))}
              />
              {a.source === 'json' || a.source === 'header' ? <Input size='sm' aria-label={a.source === 'json' ? 'JSON path' : 'Header name'} placeholder={a.source === 'json' ? '$.items[0].id' : 'content-type'} value={a.path ?? ''} onChange={e => set(i, { path: e.target.value })} style={mono} /> : <span />}
              <SelectField name={`op-${a.id}`} size='sm' value={a.op} onValueChange={v => set(i, { op: v as ApiAssertion['op'] })} options={opsFor(a.source).map(o => ({ value: o, label: ASSERTION_OPS.find(x => x.value === o)!.label }))} />
              {op?.needsValue && a.op !== 'schema' ? (
                a.op === 'type' ? (
                  <SelectField name={`type-${a.id}`} size='sm' value={a.value || 'string'} onValueChange={v => set(i, { value: v })} options={['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].map(t => ({ value: t, label: t }))} />
                ) : (
                  <Input size='sm' aria-label='Expected' placeholder='expected' value={a.value ?? ''} onChange={e => set(i, { value: e.target.value })} style={mono} />
                )
              ) : (
                <span />
              )}
              <IconButton icon='tabler-trash' label='Remove check' onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
            {a.op === 'schema' && <Textarea aria-label='JSON schema' rows={5} value={a.value ?? ''} onChange={e => set(i, { value: e.target.value })} placeholder='{"type":"object","required":["id"]}' spellCheck={false} style={mono} />}
            {r && (
              <span style={{ fontSize: 12.5, color: r.pass ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)' }}>
                {r.pass ? '✓' : '✗'} {r.message}
              </span>
            )}
          </div>
        )
      })}
      <div>
        <Button size='sm' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => onChange([...list, newAssertion(list.length ? 'json' : 'status')])}>
          Add check
        </Button>
      </div>
    </div>
  )
}

export function CapturesEditor({ list, onChange, results }: { list: ApiCapture[]; onChange: (l: ApiCapture[]) => void; results?: CaptureResult[] }) {
  const set = (i: number, patch: Partial<ApiCapture>) => onChange(list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className='flex flex-col gap-2'>
      <Typography variant='body2' style={muted}>
        Save values from the response as variables for the next requests, like a token from a login. In a run they pass to the following requests; here they last until you reload.
      </Typography>
      {list.map((c, i) => {
        const r = results?.find(x => x.variable === c.variable)

        return (
          <div key={c.id} className='flex flex-col gap-1'>
            <div className='grid items-center gap-2' style={{ gridTemplateColumns: 'auto minmax(0, 1fr) minmax(7rem, 0.8fr) minmax(0, 1.3fr) auto' }}>
              <Checkbox checked={c.enabled} onCheckedChange={v => set(i, { enabled: v === true })} aria-label='Use this capture' />
              <Input size='sm' aria-label='Variable' placeholder='variable' value={c.variable} onChange={e => set(i, { variable: e.target.value })} error={!!c.variable && !VAR_NAME_RE.test(c.variable)} style={mono} />
              <SelectField name={`cap-${c.id}`} size='sm' value={c.source} onValueChange={v => set(i, { source: v as ApiCapture['source'], path: v === 'json' ? '$.' : v === 'header' ? '' : v === 'body' ? '' : undefined })} options={[{ value: 'json', label: 'JSON path' }, { value: 'header', label: 'Header' }, { value: 'status', label: 'Status' }, { value: 'body', label: 'Body regex' }]} />
              {c.source === 'status' ? <span /> : <Input size='sm' aria-label='From' placeholder={c.source === 'json' ? '$.token' : c.source === 'header' ? 'location' : '"id":"(\\w+)"'} value={c.path ?? ''} onChange={e => set(i, { path: e.target.value })} style={mono} />}
              <IconButton icon='tabler-trash' label='Remove capture' onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
            {r && <span style={{ fontSize: 12.5, color: r.ok ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)' }}>{r.ok ? `✓ {{${r.variable}}} = ${(r.value ?? '').slice(0, 120)}` : `✗ ${r.message}`}</span>}
          </div>
        )
      })}
      <div>
        <Button size='sm' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => onChange([...list, newCapture()])}>
          Add capture
        </Button>
      </div>
    </div>
  )
}

// ── Response ─────────────────────────────────────────────────────────────────

export function TimingBar({ t }: { t: ApiResponse['timings'] }) {
  const segs = timingSegments(t)
  const total = Math.max(t.total, segs.reduce((n, s) => n + s.ms, 0), 1)
  const colors: Record<string, string> = { dns: '#8b5cf6', connect: '#f59e0b', tls: '#ec4899', firstByte: '#3b82f6', download: '#10b981' }

  return (
    <div className='flex flex-col gap-2'>
      {segs.map(s => (
        <div key={s.key} className='grid items-center gap-2' style={{ gridTemplateColumns: '9rem minmax(0, 1fr) 4.5rem', fontSize: 13 }}>
          <span style={muted}>{s.label}</span>
          <div style={{ position: 'relative', blockSize: 10, background: 'var(--vhyx-color-bg-muted)', borderRadius: 4 }}>
            <div style={{ position: 'absolute', insetInlineStart: `${(s.offset / total) * 100}%`, inlineSize: `${Math.max((s.ms / total) * 100, s.ms > 0 ? 0.8 : 0)}%`, blockSize: '100%', background: colors[s.key], borderRadius: 4 }} />
          </div>
          <span style={{ ...mono, textAlign: 'end' }}>{s.ms ? formatMs(s.ms) : '—'}</span>
        </div>
      ))}
      <div className='grid gap-2' style={{ gridTemplateColumns: '9rem minmax(0, 1fr) 4.5rem', fontSize: 13, fontWeight: 600 }}>
        <span>Total</span>
        <span />
        <span style={{ ...mono, textAlign: 'end' }}>{formatMs(t.total)}</span>
      </div>
      <Typography variant='caption' style={muted}>
        Measured from the platform&apos;s runner on a new connection. 0 for DNS or TLS means the step didn&apos;t happen (an IP address, plain HTTP).
      </Typography>
    </div>
  )
}

export type SendOutcome = {
  response: ApiResponse | null
  error: { code: string; message: string } | null
  assertions: AssertionResult[]
  captures: CaptureResult[]
  warnings: string[]
  request: SentRequest
}

export function ResponseView({ out, onSuggest }: { out: SendOutcome; onSuggest?: () => void }) {
  const [tab, setTab] = useState('body')
  const [raw, setRaw] = useState(false)
  const res = out.response
  const view = res ? bodyView(res) : null
  const passed = out.assertions.filter(a => a.pass).length

  return (
    <div className='flex flex-col gap-3'>
      {out.warnings.map(w => (
        <Alert key={w} variant='warning'>
          {w}
        </Alert>
      ))}
      {out.error && (
        <Alert variant='danger' title='No response'>
          {out.error.message}
        </Alert>
      )}
      {res && (
        <div className='flex flex-wrap items-center gap-3' style={{ fontSize: 14 }}>
          <Badge variant={statusVariant(res.status)}>
            {res.status} {res.statusText}
          </Badge>
          <span>
            <span style={muted}>Time </span>
            <strong>{formatMs(res.timings.total)}</strong>
          </span>
          <span>
            <span style={muted}>Size </span>
            <strong>{formatBytes(res.size)}</strong>
            {res.truncated && <span style={muted}> (cut)</span>}
          </span>
          {out.assertions.length > 0 && <Badge variant={passed === out.assertions.length ? 'success' : 'danger'}>{`checks ${passed}/${out.assertions.length}`}</Badge>}
          {res.redirects?.length ? <span style={muted}>{res.redirects.length} redirect{res.redirects.length === 1 ? '' : 's'}</span> : null}
        </div>
      )}
      <Tabs value={res || tab === 'checks' ? tab : 'sent'} onValueChange={setTab} variant='underline' size='sm'>
        <Tabs.List style={{ overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'thin' }}>
          {res && <Tabs.Trigger value='body'>Body</Tabs.Trigger>}
          {res && <Tabs.Trigger value='headers'>Headers ({res.headers.length})</Tabs.Trigger>}
          {out.assertions.length > 0 && <Tabs.Trigger value='checks'>Checks</Tabs.Trigger>}
          {res && <Tabs.Trigger value='timing'>Timing</Tabs.Trigger>}
          <Tabs.Trigger value='sent'>Sent</Tabs.Trigger>
        </Tabs.List>
        {res && view && (
          <Tabs.Content value='body'>
            <div className='flex flex-col gap-2 mbs-2'>
              <div className='flex items-center justify-end gap-2'>
                {(view.kind === 'json' || view.kind === 'html' || view.kind === 'xml' || view.kind === 'text') && (
                  <>
                    {view.kind === 'json' && (
                      <Button size='sm' variant='ghost' onClick={() => setRaw(!raw)}>
                        {raw ? 'Pretty' : 'Raw'}
                      </Button>
                    )}
                    <Button size='sm' variant='ghost' icon={<i className='tabler-copy' />} onClick={() => copy(raw ? res.body : view.text)}>
                      Copy
                    </Button>
                  </>
                )}
                {onSuggest && (
                  <Button size='sm' variant='ghost' icon={<i className='tabler-wand' />} onClick={onSuggest}>
                    Suggest checks
                  </Button>
                )}
              </div>
              {view.kind === 'image' ? (
                <img src={view.text} alt='Response' style={{ maxInlineSize: '100%', maxBlockSize: 360, objectFit: 'contain', alignSelf: 'start' }} />
              ) : view.kind === 'binary' ? (
                <Typography variant='body2' style={muted}>
                  {view.text}
                </Typography>
              ) : (
                <pre style={{ ...mono, margin: 0, padding: 12, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', overflow: 'auto', maxBlockSize: '55vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{(raw ? res.body : view.text) || <span style={muted}>(empty body)</span>}</pre>
              )}
            </div>
          </Tabs.Content>
        )}
        {res && (
          <Tabs.Content value='headers'>
            <HeaderList headers={res.headers} />
          </Tabs.Content>
        )}
        {out.assertions.length > 0 && (
          <Tabs.Content value='checks'>
            <CheckResults list={out.assertions} />
            {out.captures.length > 0 && (
              <div className='flex flex-col gap-1 mbs-3'>
                {out.captures.map(c => (
                  <span key={c.variable} style={{ fontSize: 13, color: c.ok ? 'inherit' : 'var(--vhyx-color-danger)' }}>
                    {c.ok ? `{{${c.variable}}} = ${(c.value ?? '').slice(0, 200)}` : `{{${c.variable}}}: ${c.message}`}
                  </span>
                ))}
              </div>
            )}
          </Tabs.Content>
        )}
        {res && (
          <Tabs.Content value='timing'>
            <div className='mbs-2'>
              <TimingBar t={res.timings} />
              {res.remoteAddress && (
                <Typography variant='caption' style={{ ...muted, display: 'block', marginBlockStart: 8 }}>
                  {res.remoteAddress} · HTTP/{res.httpVersion}
                </Typography>
              )}
            </div>
          </Tabs.Content>
        )}
        <Tabs.Content value='sent'>
          <div className='flex flex-col gap-2 mbs-2'>
            <span style={{ ...mono, wordBreak: 'break-all' }}>
              <strong>{out.request.method}</strong> {out.request.url}
            </span>
            <HeaderList headers={out.request.headers} />
            {out.request.body && <pre style={{ ...mono, margin: 0, padding: 12, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', overflow: 'auto', maxBlockSize: '30vh', whiteSpace: 'pre-wrap' }}>{out.request.body}</pre>}
            <Typography variant='caption' style={muted}>
              Secrets from environments show as {'{{name}}'}.
            </Typography>
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

function HeaderList({ headers }: { headers: Array<[string, string]> }) {
  if (!headers.length)
    return (
      <Typography variant='body2' style={muted}>
        No headers.
      </Typography>
    )

  return (
    <dl className='grid mbs-2' style={{ gridTemplateColumns: 'minmax(8rem, max-content) minmax(0, 1fr)', gap: '4px 16px', margin: 0, fontSize: 13 }}>
      {headers.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt style={{ ...mono, ...muted }}>{k}</dt>
          <dd style={{ ...mono, margin: 0, wordBreak: 'break-all' }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CheckResults({ list }: { list: AssertionResult[] }) {
  return (
    <ul className='flex flex-col gap-1 mbs-2' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {list.map((a, i) => (
        <li key={`${a.id}-${i}`} className='flex gap-2' style={{ fontSize: 13.5 }}>
          <span aria-label={a.pass ? 'passed' : 'failed'} style={{ color: a.pass ? 'var(--vhyx-color-success)' : 'var(--vhyx-color-danger)', fontWeight: 700 }}>
            {a.pass ? '✓' : '✗'}
          </span>
          <span>
            <span style={mono}>{a.label}</span> <span style={muted}>— {a.message}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ── Environments ─────────────────────────────────────────────────────────────

export function EnvironmentsDialog({ accountId, environments, max, onClose, initial }: { accountId: string; environments: Environment[]; max: number; onClose: () => void; initial?: string | null }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | 'new' | null>(initial ?? environments[0]?.id ?? 'new')
  const env = environments.find(e => e.id === selected) ?? null
  const [name, setName] = useState(env?.name ?? 'Staging')
  const [vars, setVars] = useState<EnvVariable[]>(env?.variables ?? [{ key: 'baseUrl', value: 'https://staging.example.com', enabled: true }])

  useEffect(() => {
    const e = environments.find(x => x.id === selected)

    setName(e?.name ?? (environments.some(x => x.name === 'Staging') ? '' : 'Staging'))
    setVars(e ? e.variables.map(v => (v.secret ? { ...v, keep: true } : v)) : [{ key: 'baseUrl', value: '', enabled: true }])
  }, [selected, environments])

  const done = (msg: string) => {
    toast.success(msg)
    qc.invalidateQueries({ queryKey: ['api-client', accountId] })
  }

  const save = useMutation({
    mutationFn: () => {
      const variables = vars.filter(v => v.key).map(v => (v.secret && v.keep && !v.value ? { key: v.key, value: '', enabled: v.enabled, secret: true, keep: true } : { key: v.key, value: v.value, enabled: v.enabled, secret: !!v.secret }))

      return selected === 'new' || !env ? apiClientService.createEnvironment(accountId, { name: name.trim(), variables }) : apiClientService.saveEnvironment(accountId, env.id, { name: name.trim(), variables, expectedVersion: env.version })
    },
    onSuccess: e => {
      done(`Saved ${e.name}`)
      setSelected(e.id)
    },
    onError: e => toast.danger((e as Error).message)
  })

  const remove = useMutation({
    mutationFn: () => apiClientService.removeEnvironment(accountId, env!.id),
    onSuccess: () => {
      done('Environment deleted')
      setSelected('new')
    },
    onError: e => toast.danger((e as Error).message)
  })

  const set = (i: number, patch: Partial<EnvVariable>) => setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const bad = vars.find(v => v.key && !VAR_NAME_RE.test(v.key))
  const dup = vars.find((v, i) => v.key && vars.findIndex(x => x.key === v.key) !== i)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(52rem, calc(100vw - 32px))' }}>
          <Dialog.Title>Environments</Dialog.Title>
          <Typography variant='body2' style={{ ...muted, marginBlockStart: 4 }}>
            Shared by the workspace. Secret values are encrypted, never shown again, and appear as {'{{name}}'} in code, history and reports.
          </Typography>
          <div className='grid gap-4 mbs-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))', alignItems: 'start' }}>
            <nav className='flex flex-col gap-1' aria-label='Environments' style={{ gridColumn: 'span 1' }}>
              {environments.map(e => (
                <button key={e.id} type='button' onClick={() => setSelected(e.id)} aria-current={selected === e.id ? 'true' : undefined} style={{ textAlign: 'start', padding: '6px 10px', borderRadius: 8, border: 0, cursor: 'pointer', color: 'inherit', background: selected === e.id ? 'var(--vhyx-color-bg-muted)' : 'transparent' }}>
                  {e.name} <span style={{ ...muted, fontSize: 12 }}>({e.variables.length})</span>
                </button>
              ))}
              <Button size='sm' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => setSelected('new')} disabled={environments.length >= max}>
                New environment
              </Button>
            </nav>
            <div className='flex flex-col gap-3' style={{ gridColumn: 'span 3', minInlineSize: 0 }}>
              <TextField name='env-name' label='Name' value={name} onChange={e => setName(e.target.value)} maxLength={80} />
              <div className='flex flex-col gap-1'>
                <div className='grid gap-2' style={{ gridTemplateColumns: '1.5rem minmax(0, 1fr) minmax(0, 1.4fr) 4.5rem 1.75rem', fontSize: 12, ...muted }}>
                  <span />
                  <span>Variable</span>
                  <span>Value</span>
                  <span>Secret</span>
                  <span />
                </div>
                {vars.map((v, i) => (
                  <div key={i} className='grid items-center gap-2' style={{ gridTemplateColumns: '1.5rem minmax(0, 1fr) minmax(0, 1.4fr) 4.5rem 1.75rem' }}>
                    <Checkbox checked={v.enabled} onCheckedChange={c => set(i, { enabled: c === true })} aria-label={`Use ${v.key || 'variable'}`} />
                    <Input size='sm' aria-label='Variable' value={v.key} onChange={e => set(i, { key: e.target.value })} error={!!v.key && !VAR_NAME_RE.test(v.key)} style={mono} />
                    <Input size='sm' aria-label='Value' type={v.secret ? 'password' : 'text'} autoComplete='off' value={v.value} placeholder={v.secret && v.keep && v.hasValue ? '•••••• (set; type to replace)' : ''} onChange={e => set(i, { value: e.target.value, keep: false })} style={mono} />
                    <Switch checked={!!v.secret} onCheckedChange={(c: boolean) => set(i, { secret: c, keep: c ? v.keep : false })} aria-label={`${v.key || 'variable'} is secret`} />
                    <IconButton icon='tabler-x' label='Remove variable' onClick={() => setVars(vars.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <div>
                  <Button size='sm' variant='ghost' icon={<i className='tabler-plus' />} onClick={() => setVars([...vars, { key: '', value: '', enabled: true }])}>
                    Add variable
                  </Button>
                </div>
              </div>
              {bad && <Alert variant='warning'>{`"${bad.key}" is not a variable name: letters, digits, _ . -, not starting with a digit.`}</Alert>}
              {dup && <Alert variant='warning'>{`${dup.key} is defined twice.`}</Alert>}
            </div>
          </div>
          <Dialog.Footer>
            {env && (
              <Button variant='destructive' onClick={() => remove.mutate()} loading={remove.isPending} style={{ marginInlineEnd: 'auto' }}>
                Delete
              </Button>
            )}
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || !!bad || !!dup}>
              {env ? 'Save' : 'Create'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Collection settings (variables + auth + captured values) ─────────────────

export function CollectionSettingsDialog({
  name,
  description,
  variables,
  auth,
  runtime,
  onApply,
  onClearRuntime,
  onClose
}: {
  name: string
  description: string
  variables: ApiVariable[]
  auth: ApiAuth
  runtime: Record<string, string>
  onApply: (p: { name: string; description: string; variables: ApiVariable[]; auth: ApiAuth }) => void
  onClearRuntime: () => void
  onClose: () => void
}) {
  const [n, setN] = useState(name)
  const [d, setD] = useState(description)
  const [vars, setVars] = useState<KeyValue[]>(variables)
  const [a, setA] = useState<ApiAuth>(auth)
  const bad = vars.find(v => v.key && !VAR_NAME_RE.test(v.key))

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(48rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Collection settings</Dialog.Title>
          <div className='flex flex-col gap-4 mbs-3'>
            <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))' }}>
              <TextField name='col-name' label='Name' value={n} onChange={e => setN(e.target.value)} maxLength={80} />
              <TextField name='col-desc' label='Description' value={d} onChange={e => setD(e.target.value)} maxLength={2000} />
            </div>
            <section className='flex flex-col gap-2'>
              <Typography variant='subtitle2'>Variables</Typography>
              <Typography variant='caption' style={muted}>
                Defaults for every request, e.g. baseUrl. An environment&apos;s values win over these; put secrets in an environment, where they are encrypted. Built in: {DYNAMIC_VARS.map(v => `{{${v}}}`).join(' ')}
              </Typography>
              <KeyValueEditor rows={vars} onChange={setVars} keyLabel='Variable' />
              {bad && <Alert variant='warning'>{`"${bad.key}" is not a variable name.`}</Alert>}
            </section>
            <section className='flex flex-col gap-2'>
              <Typography variant='subtitle2'>Auth for requests set to &quot;From the collection&quot;</Typography>
              <AuthEditor auth={a} onChange={setA} allowInherit={false} />
            </section>
            {Object.keys(runtime).length > 0 && (
              <section className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                  <Typography variant='subtitle2'>Captured in this session</Typography>
                  <Button size='sm' variant='ghost' onClick={onClearRuntime}>
                    Clear
                  </Button>
                </div>
                <dl className='grid' style={{ gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '4px 16px', margin: 0, fontSize: 13 }}>
                  {Object.entries(runtime).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt style={mono}>{`{{${k}}}`}</dt>
                      <dd style={{ ...mono, margin: 0, wordBreak: 'break-all', ...muted }}>{v.slice(0, 200)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!n.trim() || !!bad}
              onClick={() => {
                onApply({ name: n.trim(), description: d, variables: vars.filter(v => v.key).map(v => ({ key: v.key, value: v.value, enabled: v.enabled })), auth: a })
                onClose()
              }}
            >
              Apply
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Code snippet ─────────────────────────────────────────────────────────────

export function SnippetDialog({ accountId, request, context, languages, onClose }: { accountId: string; request: ApiRequest; context: SendContext; languages: Array<{ id: SnippetLanguage; label: string }>; onClose: () => void }) {
  const [lang, setLang] = useState<SnippetLanguage>(() => {
    try {
      return (localStorage.getItem('vv.snippetLang') as SnippetLanguage) || 'curl'
    } catch {
      return 'curl'
    }
  })

  const q = useQuery({ queryKey: ['api-client', accountId, 'snippet', lang, JSON.stringify(request), JSON.stringify(context)], queryFn: () => apiClientService.snippet(accountId, { request, lang, ...context }) })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(48rem, calc(100vw - 32px))' }}>
          <Dialog.Title>Code</Dialog.Title>
          <div className='flex flex-col gap-3 mbs-3'>
            <div className='flex flex-wrap gap-1' role='radiogroup' aria-label='Language'>
              {languages.map(l => (
                <button
                  key={l.id}
                  type='button'
                  role='radio'
                  aria-checked={lang === l.id}
                  onClick={() => {
                    setLang(l.id)
                    try {
                      localStorage.setItem('vv.snippetLang', l.id)
                    } catch {
                      /* private mode */
                    }
                  }}
                  style={{ padding: '4px 10px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: '1px solid var(--vhyx-color-border)', color: 'inherit', background: lang === l.id ? 'var(--vhyx-color-bg-muted)' : 'transparent', fontWeight: lang === l.id ? 600 : 400 }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {q.isLoading ? (
              <Skeleton height='12rem' />
            ) : q.error ? (
              <Alert variant='danger'>{(q.error as Error).message}</Alert>
            ) : q.data?.code ? (
              <pre style={{ ...mono, margin: 0, padding: 12, borderRadius: 8, background: 'var(--vhyx-color-bg-muted)', overflow: 'auto', maxBlockSize: '55vh' }}>{q.data.code}</pre>
            ) : (
              <Alert variant='warning'>{q.data?.problems.join('; ')}</Alert>
            )}
            <Typography variant='caption' style={muted}>
              Variables are filled in; secret values stay as {'{{name}}'}.
            </Typography>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
            <Button icon={<i className='tabler-copy' />} disabled={!q.data?.code} onClick={() => copy(q.data!.code!)}>
              Copy
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Import into the open collection ──────────────────────────────────────────

export function ImportIntoDialog({ accountId, onAdd, onClose }: { accountId: string; onAdd: (p: ParsedDocument) => void; onClose: () => void }) {
  const [doc, setDoc] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parse = useMutation({
    mutationFn: () => apiClientService.parse(accountId, doc),
    onSuccess: p => {
      if (p.warnings.length) toast.warning(p.warnings.slice(0, 3).join('; '))
      onAdd(p)
      onClose()
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(40rem, calc(100vw - 32px))' }}>
          <Dialog.Title>Add requests</Dialog.Title>
          <div className='flex flex-col gap-3 mbs-3'>
            <Typography variant='body2' style={muted}>
              Paste a curl command (dev tools: right-click a request → Copy as cURL), or a Postman collection, OpenAPI document or HAR file. Its requests are added to this collection, in a new folder when there are several.
            </Typography>
            <Textarea aria-label='curl command or document' rows={10} value={doc} onChange={e => setDoc(e.target.value)} placeholder="curl 'https://api.example.com/v1/orders' -H 'accept: application/json'" style={mono} spellCheck={false} />
            <div className='flex items-center gap-2'>
              <input
                ref={fileRef}
                type='file'
                accept='.json,.yaml,.yml,.har'
                hidden
                onChange={async e => {
                  const f = e.target.files?.[0]

                  if (f) setDoc(await f.text())
                }}
              />
              <Button size='sm' variant='outline' icon={<i className='tabler-upload' />} onClick={() => fileRef.current?.click()}>
                Choose a file
              </Button>
            </div>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => parse.mutate()} loading={parse.isPending} disabled={doc.trim().length < 2}>
              Add
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

// ── Run report ───────────────────────────────────────────────────────────────

const OUTCOME: Record<RunResult['outcome'], { mark: string; color: string }> = {
  passed: { mark: '✓', color: 'var(--vhyx-color-success)' },
  failed: { mark: '✗', color: 'var(--vhyx-color-danger)' },
  errored: { mark: '!', color: 'var(--vhyx-color-warning)' },
  skipped: { mark: '–', color: 'var(--vhyx-color-text-muted)' }
}

export function RunReportView({ report }: { report: RunReport }) {
  const [open, setOpen] = useState<string | null>(() => report.results.find(r => r.outcome !== 'passed')?.requestId ?? null)
  const ok = report.failed === 0 && report.errored === 0

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'All passed' : `${report.failed + report.errored} failing`}</Badge>
        <span style={{ fontSize: 14 }}>
          {report.passed}/{report.total} requests · checks {report.assertions.passed}/{report.assertions.passed + report.assertions.failed} · {formatMs(report.durationMs)}
          {report.environment ? ` · ${report.environment}` : ''}
        </span>
        {report.skipped > 0 && <Badge variant='default'>{`${report.skipped} skipped`}</Badge>}
      </div>
      <div style={{ blockSize: 8, display: 'flex', borderRadius: 4, overflow: 'hidden', background: 'var(--vhyx-color-bg-muted)' }} aria-hidden>
        {(['passed', 'failed', 'errored', 'skipped'] as const).map(k => (report[k] ? <div key={k} style={{ flex: report[k], background: OUTCOME[k].color }} /> : null))}
      </div>
      <ul className='flex flex-col' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {report.results.map(r => (
          <li key={r.requestId} style={{ borderBlockEnd: '1px solid var(--vhyx-color-border)' }}>
            <button type='button' onClick={() => setOpen(open === r.requestId ? null : r.requestId)} aria-expanded={open === r.requestId} className='grid items-center gap-2' style={{ inlineSize: '100%', gridTemplateColumns: '1.25rem 4rem minmax(0, 1fr) auto', padding: '8px 4px', background: 'none', border: 0, color: 'inherit', textAlign: 'start', cursor: 'pointer' }}>
              <span style={{ color: OUTCOME[r.outcome].color, fontWeight: 700 }}>{OUTCOME[r.outcome].mark}</span>
              <span style={{ ...mono, fontSize: 12 }}>{r.method}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.folder.length ? <span style={muted}>{r.folder.join(' / ')} / </span> : null}
                {r.name}
              </span>
              <span style={{ ...mono, fontSize: 12, ...muted }}>
                {r.status !== undefined ? `${r.status} · ${formatMs(r.timeMs ?? 0)}` : r.outcome}
              </span>
            </button>
            {open === r.requestId && (
              <div className='flex flex-col gap-2' style={{ padding: '0 8px 12px 28px' }}>
                <span style={{ ...mono, fontSize: 12, ...muted, wordBreak: 'break-all' }}>{r.url}</span>
                {r.error && <Alert variant={r.outcome === 'skipped' ? 'info' : 'warning'}>{r.error}</Alert>}
                {r.assertions.length > 0 && <CheckResults list={r.assertions} />}
                {r.assertions.length === 0 && !r.error && (
                  <Typography variant='caption' style={muted}>
                    No checks on this request: any answer passes.
                  </Typography>
                )}
                {r.captures.map(c => (
                  <span key={c.variable} style={{ fontSize: 13 }}>
                    {c.ok ? `{{${c.variable}}} = ${(c.value ?? '').slice(0, 120)}` : `{{${c.variable}}}: ${c.message}`}
                  </span>
                ))}
                {r.responsePreview && <pre style={{ ...mono, fontSize: 12, margin: 0, padding: 8, borderRadius: 6, background: 'var(--vhyx-color-bg-muted)', maxBlockSize: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{r.responsePreview}</pre>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RunDialog({ accountId, collectionId, folders, environmentId, environments, runtime, dirty, onClose }: { accountId: string; collectionId: string; folders: Array<{ id: string; name: string }>; environmentId: string | null; environments: Environment[]; runtime: Record<string, string>; dirty: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [env, setEnv] = useState(environmentId ?? '')
  const [folder, setFolder] = useState('')
  const [bail, setBail] = useState(false)
  const [report, setReport] = useState<RunReport | null>(null)
  const runs = useQuery({ queryKey: ['api-client', accountId, 'runs', collectionId], queryFn: () => apiClientService.runs(accountId, collectionId) })

  const run = useMutation({
    mutationFn: () => apiClientService.run(accountId, collectionId, { environmentId: env || null, folderId: folder || null, bail, runtime }),
    onSuccess: r => {
      setReport(r.report)
      if (r.rateLimited) toast.warning('The plan’s send rate was reached; the rest was skipped')
      qc.invalidateQueries({ queryKey: ['api-client', accountId, 'runs', collectionId] })
    },
    onError: e => toast.danger((e as Error).message)
  })

  const openRun = useMutation({
    mutationFn: (id: string) => apiClientService.runDetail(accountId, id),
    onSuccess: r => (r.report ? setReport(r.report) : toast.info(r.status === 'running' ? 'This run is still going' : (r.error ?? 'This run has no report'))),
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content style={{ inlineSize: 'min(56rem, calc(100vw - 32px))', maxBlockSize: 'calc(100vh - 48px)', overflowY: 'auto' }}>
          <Dialog.Title>Run collection</Dialog.Title>
          <div className='flex flex-col gap-4 mbs-3'>
            {dirty && <Alert variant='info'>Runs use the saved collection. Save first to include your latest changes.</Alert>}
            <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))', alignItems: 'end' }}>
              <SelectField name='run-env' label='Environment' value={env} onValueChange={setEnv} options={[{ value: '', label: 'None' }, ...environments.map(e => ({ value: e.id, label: e.name }))]} />
              <SelectField name='run-folder' label='Requests' value={folder} onValueChange={setFolder} options={[{ value: '', label: 'Whole collection' }, ...folders.map(f => ({ value: f.id, label: `Folder: ${f.name}` }))]} />
              <label className='flex items-center gap-2' style={{ fontSize: 14, paddingBlockEnd: 8 }}>
                <Switch checked={bail} onCheckedChange={(v: boolean) => setBail(v)} aria-label='Stop at the first failure' /> Stop at the first failure
              </label>
            </div>
            <div className='flex gap-2'>
              <Button icon={<i className='tabler-player-play' />} loading={run.isPending} onClick={() => run.mutate()}>
                Run now
              </Button>
            </div>
            {report && (
              <Card className='p-3'>
                <RunReportView report={report} />
              </Card>
            )}
            <section className='flex flex-col gap-2'>
              <Typography variant='subtitle2'>Recent runs</Typography>
              {runs.isLoading ? (
                <Skeleton height='4rem' />
              ) : !runs.data?.runs.length ? (
                <Typography variant='caption' style={muted}>
                  No runs yet.
                </Typography>
              ) : (
                <ul className='flex flex-col' style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {runs.data.runs.slice(0, 10).map(r => (
                    <li key={r.id}>
                      <button type='button' onClick={() => openRun.mutate(r.id)} className='flex flex-wrap items-center gap-3' style={{ inlineSize: '100%', padding: '6px 4px', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'start', fontSize: 13 }}>
                        {r.status === 'running' ? (
                          <Badge size='sm' variant='info'>
                            running
                          </Badge>
                        ) : r.status === 'failed' ? (
                          <Badge size='sm' variant='danger'>
                            stopped
                          </Badge>
                        ) : (
                          <Badge size='sm' variant={r.failed + r.errored === 0 ? 'success' : 'danger'}>
                            {r.failed + r.errored === 0 ? 'passed' : `${r.failed + r.errored} failing`}
                          </Badge>
                        )}
                        <span>
                          {r.status === 'done' ? `${r.passed}/${r.total} · ${formatMs(r.durationMs)}` : r.status === 'running' ? 'in progress' : (r.error ?? 'stopped')}
                          {r.environmentName ? ` · ${r.environmentName}` : ''}
                        </span>
                        <span style={muted}>{new Date(r.createdAt).toLocaleString()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
