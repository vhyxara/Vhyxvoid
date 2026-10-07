'use client'

// Rendered API docs from a docs model (packages/shared/src/apiSpec.ts
// specModel): a contents column, then each operation with its parameters,
// body, responses, code samples and an optional "Try it" panel. Used by the
// spec editor's preview and by the public docs page. Colours come from the
// vhyx tokens, so it follows the light/dark theme.

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import ReactMarkdown from 'react-markdown'

import { Badge, Button, Input, Tabs, toast } from '@vhyxui/react'

import type {
  DocsMedia,
  DocsModel,
  DocsOperation,
  DocsParameter,
  SnippetLang
} from '@/api/infrastructure/services/specs.service'
import {
  buildTryPath,
  exampleText,
  methodColor,
  schemaLabel,
  schemaRows,
  type TryInput
} from '@/views/org/specs/specForm'

const muted: CSSProperties = { color: 'var(--vhyx-color-text-muted)' }
const mono: CSSProperties = { fontFamily: 'var(--vhyx-font-mono, ui-monospace, monospace)', fontSize: 13 }
const codeBox: CSSProperties = {
  ...mono,
  margin: 0,
  padding: 12,
  borderRadius: 8,
  background: 'var(--vhyx-color-bg-muted)',
  border: '1px solid var(--vhyx-color-border)',
  overflow: 'auto',
  maxBlockSize: 420,
  whiteSpace: 'pre'
}
// The contents column only on wide screens; narrow screens get the filter in the page.
const DOCS_CSS = `
.vv-docs { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); align-items: start; }
.vv-docs-nav { display: none; }
.vv-docs-md p { margin: 0 0 8px; }
.vv-docs-md p:last-child { margin-bottom: 0; }
.vv-docs-md code { font-family: var(--vhyx-font-mono, ui-monospace, monospace); font-size: 0.92em; background: var(--vhyx-color-bg-muted); padding: 1px 4px; border-radius: 4px; }
@media (min-width: 960px) {
  .vv-docs-with-nav { grid-template-columns: 15rem minmax(0, 1fr); }
  .vv-docs-with-nav .vv-docs-nav { display: block; position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
  .vv-docs-with-nav .vv-docs-narrow-only { display: none; }
}
`
const LANG_LABEL: Record<SnippetLang, string> = { curl: 'cURL', fetch: 'JavaScript', python: 'Python', go: 'Go' }

export type TryAnswer = {
  status: number
  headers: Record<string, string>
  body: string
  ms: number
  truncated?: boolean
}

export type TryHandler = (
  op: DocsOperation,
  req: { server: string; path: string; method: string; headers: Record<string, string>; body?: string }
) => Promise<TryAnswer>

type Props = {
  model: DocsModel
  /** Send a request; without it there is no Try it panel. */
  onTry?: TryHandler
  /** Shown above the Try it button, e.g. "Requests go to the mock API". */
  tryNote?: string
  /** Content above the title (version picker, download links). */
  toolbar?: ReactNode
  /** Inside the editor: no sticky contents column. */
  compact?: boolean
}

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied'),
    () => toast.danger('Could not copy')
  )
}

export function MethodBadge({ method, small }: { method: string; small?: boolean }) {
  return (
    <span
      style={{
        ...mono,
        fontSize: small ? 10 : 12,
        fontWeight: 700,
        color: '#fff',
        background: methodColor(method),
        borderRadius: 6,
        padding: small ? '1px 5px' : '2px 8px',
        minInlineSize: small ? 44 : 58,
        textAlign: 'center',
        display: 'inline-block',
        flex: 'none'
      }}
    >
      {method.toUpperCase()}
    </span>
  )
}

function Markdown({ text }: { text: string }) {
  if (!text) return null

  return (
    <div className='vv-docs-md' style={{ fontSize: 14, lineHeight: 1.6 }}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

export default function SpecDocsView({ model, onTry, tryNote, toolbar, compact }: Props) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()

  const tags = useMemo(
    () =>
      model.tags
        .map(t => ({
          ...t,
          operations: t.operations.filter(
            o => !q || `${o.method} ${o.path} ${o.summary} ${o.operationId}`.toLowerCase().includes(q)
          )
        }))
        .filter(t => t.operations.length),
    [model, q]
  )

  return (
    <div className={compact ? 'vv-docs' : 'vv-docs vv-docs-with-nav'}>
      <style>{DOCS_CSS}</style>
      {!compact && (
        <nav aria-label='Contents' className='vv-docs-nav'>
          <Input
            size='sm'
            placeholder='Filter operations'
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label='Filter operations'
          />
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '12px 0 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            {tags.map(t => (
              <li key={t.name}>
                <a
                  href={`#tag-${encodeURIComponent(t.name)}`}
                  style={{ fontWeight: 600, fontSize: 13, color: 'inherit', textTransform: 'capitalize' }}
                >
                  {t.name}
                </a>
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: '6px 0 0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}
                >
                  {t.operations.map(o => (
                    <li key={o.id}>
                      <a
                        href={`#${o.id}`}
                        className='flex items-center gap-2'
                        style={{
                          color: 'inherit',
                          fontSize: 13,
                          textDecoration: 'none',
                          opacity: o.deprecated ? 0.6 : 1
                        }}
                      >
                        <MethodBadge method={o.method} small />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.summary || o.path}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {model.schemas.length > 0 && (
              <li>
                <a href='#models' style={{ fontWeight: 600, fontSize: 13, color: 'inherit' }}>
                  Models
                </a>
              </li>
            )}
          </ul>
        </nav>
      )}

      <div style={{ minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <header className='flex flex-col gap-2'>
          {toolbar}
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 style={{ margin: 0, fontSize: compact ? 22 : 28, fontWeight: 700 }}>{model.title}</h1>
            {model.version && <Badge variant='outline'>v{model.version}</Badge>}
            <Badge variant='default'>OpenAPI {model.openapi}</Badge>
          </div>
          <Markdown text={model.description} />
          {model.servers.length > 0 && (
            <div className='flex flex-col gap-1'>
              <span style={{ ...muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Servers
              </span>
              {model.servers.map(s => (
                <div key={s.url} className='flex items-center gap-2 flex-wrap'>
                  <button
                    type='button'
                    onClick={() => copy(s.url)}
                    title='Copy'
                    style={{
                      ...mono,
                      background: 'none',
                      border: 0,
                      padding: 0,
                      color: 'var(--vhyx-color-accent)',
                      cursor: 'copy',
                      wordBreak: 'break-all',
                      textAlign: 'start'
                    }}
                  >
                    {s.url}
                  </button>
                  {s.description && <span style={{ ...muted, fontSize: 13 }}>{s.description}</span>}
                </div>
              ))}
            </div>
          )}
          {model.securitySchemes.length > 0 && (
            <div className='flex flex-col gap-1'>
              <span style={{ ...muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Authentication
              </span>
              {model.securitySchemes.map(s => (
                <span key={s.name} style={{ fontSize: 14 }}>
                  <strong>{s.name}</strong>: {authText(s)}
                  {s.description ? ` — ${s.description}` : ''}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className={compact ? undefined : 'vv-docs-narrow-only'}>
          <Input
            size='sm'
            placeholder='Filter operations'
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label='Filter operations'
          />
        </div>

        {tags.length === 0 && (
          <p style={muted}>{q ? 'No operation matches.' : 'No operations yet. Add paths to the spec.'}</p>
        )}

        {tags.map(t => (
          <section
            key={t.name}
            id={`tag-${encodeURIComponent(t.name)}`}
            className='flex flex-col gap-6'
            style={{ scrollMarginTop: 16 }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, textTransform: 'capitalize' }}>{t.name}</h2>
              <Markdown text={t.description} />
            </div>
            {t.operations.map(o => (
              <Operation key={`${t.name}-${o.id}`} op={o} servers={model.servers} onTry={onTry} tryNote={tryNote} />
            ))}
          </section>
        ))}

        {model.schemas.length > 0 && (
          <section id='models' className='flex flex-col gap-4' style={{ scrollMarginTop: 16 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Models</h2>
            {model.schemas.map(s => (
              <details
                key={s.name}
                style={{ border: '1px solid var(--vhyx-color-border)', borderRadius: 10, padding: '10px 14px' }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, ...mono, fontSize: 14 }}>{s.name}</summary>
                <div className='flex flex-col gap-2' style={{ marginTop: 10 }}>
                  <Markdown text={s.description} />
                  <SchemaTable schema={s.schema} />
                </div>
              </details>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function authText(s: DocsModel['securitySchemes'][number]): string {
  if (s.type === 'http')
    return s.scheme.toLowerCase() === 'bearer'
      ? `Bearer token in the Authorization header${s.bearerFormat ? ` (${s.bearerFormat})` : ''}`
      : `HTTP ${s.scheme}`
  if (s.type === 'apiKey') return `API key in the ${s.in} ${s.in === 'header' ? 'header ' : 'parameter '}${s.paramName}`
  if (s.type === 'oauth2') return 'OAuth 2'
  if (s.type === 'openIdConnect') return 'OpenID Connect'

  return s.type
}

function Operation({
  op,
  servers,
  onTry,
  tryNote
}: {
  op: DocsOperation
  servers: DocsModel['servers']
  onTry?: TryHandler
  tryNote?: string
}) {
  const [trying, setTrying] = useState(false)
  const groups = (['path', 'query', 'header', 'cookie'] as const)
    .map(where => ({ where, params: op.parameters.filter(p => p.in === where) }))
    .filter(g => g.params.length)
  const langs = (Object.keys(op.samples) as SnippetLang[]).filter(l => op.samples[l])

  return (
    <article
      id={op.id}
      className='flex flex-col gap-4'
      style={{ scrollMarginTop: 16, borderBlockStart: '1px solid var(--vhyx-color-border)', paddingBlockStart: 20 }}
    >
      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2 flex-wrap'>
          <MethodBadge method={op.method} />
          <code style={{ ...mono, fontSize: 15, fontWeight: 600, wordBreak: 'break-all' }}>{op.path}</code>
          {op.deprecated && <Badge variant='warning'>deprecated</Badge>}
          <a href={`#${op.id}`} aria-label='Link to this operation' style={{ ...muted, marginInlineStart: 'auto' }}>
            <i className='tabler-link' aria-hidden />
          </a>
        </div>
        {op.summary && <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{op.summary}</h3>}
        <Markdown text={op.description} />
        <span style={{ ...muted, fontSize: 13 }}>
          {op.security.length ? `Needs ${op.security.map(s => s.join(' + ')).join(' or ')}` : 'No authentication'}
          {op.operationId ? ` · operationId ${op.operationId}` : ''}
        </span>
      </div>

      {groups.map(g => (
        <ParamTable
          key={g.where}
          title={`${g.where[0].toUpperCase()}${g.where.slice(1)} parameters`}
          params={g.params}
        />
      ))}

      {op.requestBody && (
        <div className='flex flex-col gap-2'>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Request body{' '}
            {op.requestBody.required ? (
              <Badge size='sm' variant='danger'>
                required
              </Badge>
            ) : (
              <Badge size='sm' variant='default'>
                optional
              </Badge>
            )}
          </h4>
          <Markdown text={op.requestBody.description} />
          <MediaList contents={op.requestBody.contents} />
        </div>
      )}

      <div className='flex flex-col gap-2'>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Responses</h4>
        {op.responses.map(r => (
          <details
            key={r.code}
            open={r.code.startsWith('2')}
            style={{ border: '1px solid var(--vhyx-color-border)', borderRadius: 10, padding: '8px 12px' }}
          >
            <summary className='flex items-center gap-2' style={{ cursor: 'pointer', listStyle: 'revert' }}>
              <Badge
                size='sm'
                variant={
                  r.code.startsWith('2')
                    ? 'success'
                    : r.code.startsWith('3')
                      ? 'info'
                      : r.code.startsWith('4')
                        ? 'warning'
                        : r.code.startsWith('5')
                          ? 'danger'
                          : 'default'
                }
              >
                {r.code}
              </Badge>
              <span style={{ fontSize: 14 }}>{r.description}</span>
            </summary>
            <div className='flex flex-col gap-2' style={{ marginTop: 10 }}>
              {r.headers.length > 0 && (
                <div style={{ fontSize: 13 }}>
                  {r.headers.map(h => (
                    <div key={h.name}>
                      <code style={mono}>{h.name}</code> <span style={muted}>{schemaLabel(h.schema)}</span>{' '}
                      {h.description}
                    </div>
                  ))}
                </div>
              )}
              {r.contents.length ? (
                <MediaList contents={r.contents} />
              ) : (
                <span style={{ ...muted, fontSize: 13 }}>No body.</span>
              )}
            </div>
          </details>
        ))}
      </div>

      {langs.length > 0 && (
        <Tabs defaultValue={langs[0]} variant='pills'>
          <Tabs.List aria-label='Code samples'>
            {langs.map(l => (
              <Tabs.Trigger key={l} value={l}>
                {LANG_LABEL[l]}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {langs.map(l => (
            <Tabs.Content key={l} value={l}>
              <div style={{ position: 'relative', marginTop: 8 }}>
                <pre style={codeBox}>{op.samples[l]}</pre>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => copy(op.samples[l]!)}
                  style={{ position: 'absolute', insetBlockStart: 6, insetInlineEnd: 6 }}
                  aria-label={`Copy ${LANG_LABEL[l]}`}
                >
                  <i className='tabler-copy' aria-hidden />
                </Button>
              </div>
            </Tabs.Content>
          ))}
        </Tabs>
      )}

      {onTry && (
        <div className='flex flex-col gap-2'>
          {!trying ? (
            <div className='flex items-center gap-3 flex-wrap'>
              <Button size='sm' variant='outline' onClick={() => setTrying(true)}>
                <i className='tabler-player-play' aria-hidden /> Try it
              </Button>
              {tryNote && <span style={{ ...muted, fontSize: 13 }}>{tryNote}</span>}
            </div>
          ) : (
            <TryPanel op={op} servers={servers} onTry={onTry} onClose={() => setTrying(false)} tryNote={tryNote} />
          )}
        </div>
      )}
    </article>
  )
}

function ParamTable({ title, params }: { title: string; params: DocsParameter[] }) {
  return (
    <div className='flex flex-col gap-2'>
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {params.map(p => (
              <tr
                key={`${p.in}:${p.name}`}
                style={{ borderBlockEnd: '1px solid var(--vhyx-color-border)', verticalAlign: 'top' }}
              >
                <td style={{ padding: '8px 12px 8px 0', whiteSpace: 'nowrap' }}>
                  <code style={{ ...mono, fontWeight: 600 }}>{p.name}</code>
                  {p.required && (
                    <span style={{ color: 'var(--vhyx-color-danger)', marginInlineStart: 4 }} title='required'>
                      *
                    </span>
                  )}
                  <div style={{ ...muted, fontSize: 12 }}>{schemaLabel(p.schema)}</div>
                </td>
                <td style={{ padding: '8px 0', inlineSize: '100%' }}>
                  <Markdown text={p.description} />
                  {p.example !== undefined && (
                    <span style={{ ...muted, fontSize: 12 }}>
                      Example: <code style={mono}>{exampleText(p.example)}</code>
                    </span>
                  )}
                  {p.deprecated && (
                    <Badge size='sm' variant='warning'>
                      deprecated
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SchemaTable({ schema }: { schema: unknown }) {
  const rows = schemaRows(schema)

  if (!rows.length) return <span style={{ ...muted, fontSize: 13 }}>{schemaLabel(schema)}</span>

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${i}-${r.name}`}
              style={{ borderBlockEnd: '1px solid var(--vhyx-color-border)', verticalAlign: 'top' }}
            >
              <td style={{ padding: '6px 12px 6px 0', paddingInlineStart: r.depth * 16, whiteSpace: 'nowrap' }}>
                <code style={{ ...mono, fontWeight: 600 }}>{r.name}</code>
                {r.required && (
                  <span style={{ color: 'var(--vhyx-color-danger)', marginInlineStart: 4 }} title='required'>
                    *
                  </span>
                )}
                <div style={{ ...muted, fontSize: 12 }}>{r.type}</div>
              </td>
              <td style={{ padding: '6px 0', inlineSize: '100%' }}>
                {r.description}
                {r.extra.length > 0 && <div style={{ ...muted, fontSize: 12 }}>{r.extra.join(' · ')}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MediaList({ contents }: { contents: DocsMedia[] }) {
  const [active, setActive] = useState(0)
  const m = contents[Math.min(active, contents.length - 1)]

  if (!m) return null

  return (
    <div className='flex flex-col gap-2'>
      {contents.length > 1 ? (
        <div className='flex gap-2 flex-wrap'>
          {contents.map((c, i) => (
            <Button key={c.type} size='sm' variant={i === active ? 'secondary' : 'ghost'} onClick={() => setActive(i)}>
              {c.type}
            </Button>
          ))}
        </div>
      ) : (
        <span style={{ ...muted, ...mono, fontSize: 12 }}>{m.type}</span>
      )}
      <SchemaTable schema={m.schema} />
      {m.example !== undefined && (
        <div className='flex flex-col gap-1'>
          <span style={{ ...muted, fontSize: 12 }}>Example</span>
          <pre style={codeBox}>{exampleText(m.example)}</pre>
        </div>
      )}
    </div>
  )
}

function TryPanel({
  op,
  servers,
  onTry,
  onClose,
  tryNote
}: {
  op: DocsOperation
  servers: DocsModel['servers']
  onTry: TryHandler
  onClose: () => void
  tryNote?: string
}) {
  const pathParams = op.parameters.filter(p => p.in === 'path')
  const queryParams = op.parameters.filter(p => p.in === 'query')
  const headerParams = op.parameters.filter(p => p.in === 'header')
  const json = op.requestBody?.contents.find(c => c.type.includes('json')) ?? op.requestBody?.contents[0]
  const [server, setServer] = useState(servers[0]?.url ?? '')
  const [input, setInput] = useState<TryInput>({
    pathValues: Object.fromEntries(pathParams.map(p => [p.name, p.example !== undefined ? String(p.example) : ''])),
    query: queryParams.map(p => [p.name, p.example !== undefined && p.required ? String(p.example) : '']),
    headers: [
      ...headerParams.map(p => [p.name, p.example !== undefined ? String(p.example) : ''] as [string, string]),
      ...(op.security.length ? [['Authorization', ''] as [string, string]] : [])
    ],
    body: json ? exampleText(json.example ?? {}) : ''
  })
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<TryAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const built = buildTryPath(op.path, input)

  async function send() {
    setBusy(true)
    setError(null)
    setAnswer(null)

    try {
      const headers = Object.fromEntries(input.headers.filter(([k, v]) => k && v))

      if (json && input.body) headers['content-type'] ??= json.type
      setAnswer(
        await onTry(op, {
          server,
          path: built.path,
          method: op.method,
          headers,
          ...(op.requestBody && input.body ? { body: input.body } : {})
        })
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, required?: boolean) => (
    <label key={label} className='flex flex-col gap-1' style={{ fontSize: 13 }}>
      <span>
        <code style={mono}>{label}</code>
        {required && <span style={{ color: 'var(--vhyx-color-danger)' }}> *</span>}
      </span>
      <Input size='sm' value={value} onChange={e => onChange(e.target.value)} aria-label={label} />
    </label>
  )

  return (
    <div
      className='flex flex-col gap-3'
      style={{
        border: '1px solid var(--vhyx-color-border)',
        borderRadius: 10,
        padding: 14,
        background: 'var(--vhyx-color-bg-subtle)'
      }}
    >
      <div className='flex items-center justify-between gap-2'>
        <strong style={{ fontSize: 14 }}>Try it</strong>
        <Button size='sm' variant='ghost' onClick={onClose} aria-label='Close'>
          <i className='tabler-x' aria-hidden />
        </Button>
      </div>
      {tryNote && <span style={{ ...muted, fontSize: 13 }}>{tryNote}</span>}
      {servers.length > 1 && (
        <label className='flex flex-col gap-1' style={{ fontSize: 13 }}>
          Server
          <select
            value={server}
            onChange={e => setServer(e.target.value)}
            style={{
              ...mono,
              padding: 6,
              borderRadius: 6,
              background: 'var(--vhyx-color-bg)',
              color: 'inherit',
              border: '1px solid var(--vhyx-color-border)'
            }}
          >
            {servers.map(s => (
              <option key={s.url} value={s.url}>
                {s.url}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className='grid gap-3' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 12rem), 1fr))' }}>
        {pathParams.map(p =>
          field(
            p.name,
            input.pathValues[p.name] ?? '',
            v => setInput(s => ({ ...s, pathValues: { ...s.pathValues, [p.name]: v } })),
            true
          )
        )}
        {queryParams.map((p, i) =>
          field(
            `?${p.name}`,
            input.query[i]?.[1] ?? '',
            v => setInput(s => ({ ...s, query: s.query.map((q, j) => (j === i ? [q[0], v] : q)) })),
            p.required
          )
        )}
        {input.headers.map(([k, v], i) =>
          field(k, v, nv => setInput(s => ({ ...s, headers: s.headers.map((h, j) => (j === i ? [h[0], nv] : h)) })))
        )}
      </div>
      {op.requestBody && (
        <label className='flex flex-col gap-1' style={{ fontSize: 13 }}>
          Body {json ? <span style={muted}>({json.type})</span> : null}
          <textarea
            value={input.body}
            onChange={e => setInput(s => ({ ...s, body: e.target.value }))}
            rows={Math.min(14, Math.max(4, input.body.split('\n').length))}
            spellCheck={false}
            style={{ ...codeBox, maxBlockSize: 'none', color: 'inherit', resize: 'vertical' }}
          />
        </label>
      )}
      <div className='flex items-center gap-3 flex-wrap'>
        <Button size='sm' onClick={send} loading={busy} disabled={built.missing.length > 0}>
          Send
        </Button>
        <code style={{ ...mono, ...muted, wordBreak: 'break-all' }}>
          {op.method} {built.path}
        </code>
        {built.missing.length > 0 && (
          <span style={{ color: 'var(--vhyx-color-danger)', fontSize: 13 }}>Fill in {built.missing.join(', ')}</span>
        )}
      </div>
      {error && <span style={{ color: 'var(--vhyx-color-danger)', fontSize: 13 }}>{error}</span>}
      {answer && (
        <div className='flex flex-col gap-2' aria-live='polite'>
          <div className='flex items-center gap-2'>
            <Badge
              variant={
                answer.status < 300
                  ? 'success'
                  : answer.status < 400
                    ? 'info'
                    : answer.status < 500
                      ? 'warning'
                      : 'danger'
              }
            >
              {answer.status || 'no answer'}
            </Badge>
            <span style={{ ...muted, fontSize: 13 }}>{answer.ms} ms</span>
            {answer.truncated && <span style={{ ...muted, fontSize: 13 }}>· cut at 256 KB</span>}
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Headers</summary>
            <pre style={{ ...codeBox, marginTop: 6 }}>
              {Object.entries(answer.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
            </pre>
          </details>
          <pre style={codeBox}>{pretty(answer.body)}</pre>
        </div>
      )}
    </div>
  )
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
