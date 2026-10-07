// Pure helpers for the API docs views: schema tables, try-it requests, form
// edits on the parsed document, and finding a problem's line in the text.

// An OpenAPI document is free-form JSON; the server validates it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

export const SPEC_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const
export type SpecMethod = (typeof SPEC_METHODS)[number]

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/

// ── Schemas ─────────────────────────────────────────────────────────────────

/** allOf parts merged (properties, required, type) so tables show one object. */
export function flatten(schema: unknown): Json {
  if (!isObj(schema)) return {}
  if (!Array.isArray(schema.allOf)) return schema
  const { allOf, ...rest } = schema
  const out: Json = { ...rest, properties: { ...(rest.properties ?? {}) }, required: [...(rest.required ?? [])] }

  for (const part of allOf) {
    const f = flatten(part)

    Object.assign(out.properties, f.properties ?? {})
    out.required.push(...(f.required ?? []))
    out.type ??= f.type
    out.description ??= f.description
  }

  if (!Object.keys(out.properties).length) delete out.properties
  if (!out.required.length) delete out.required

  return out
}

/** "string (email)", "array of User", "one of: a | b", "User". */
export function schemaLabel(schema: unknown): string {
  if (!isObj(schema)) return 'any'
  if (schema.$ref && !schema.type && !schema.properties)
    return String(schema.title ?? String(schema.$ref).split('/').pop())
  const s = flatten(schema)

  if (Array.isArray(s.oneOf) || Array.isArray(s.anyOf))
    return `one of: ${(s.oneOf ?? s.anyOf).map(schemaLabel).join(' | ')}`
  const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type

  if (type === 'array') return `array of ${schemaLabel(s.items)}`
  if (s['x-ref'] && (type === 'object' || s.properties)) return String(s['x-ref'])
  const base = String(type ?? (s.properties ? 'object' : 'any'))

  return s.format ? `${base} (${s.format})` : base
}

export type SchemaRow = {
  name: string
  depth: number
  type: string
  required: boolean
  description: string
  extra: string[]
}

/** A property table: nested objects and array items indented, at most `maxDepth` levels. */
export function schemaRows(schema: unknown, maxDepth = 4): SchemaRow[] {
  const rows: SchemaRow[] = []

  const walk = (s: unknown, depth: number) => {
    let f = flatten(s)

    if (f.type === 'array' && isObj(f.items)) f = flatten(f.items)
    if (!isObj(f.properties) || depth > maxDepth) return
    const required = new Set<string>(f.required ?? [])

    for (const [name, p] of Object.entries(f.properties)) {
      const fp = flatten(p)
      const extra: string[] = []

      if (Array.isArray(fp.enum)) extra.push(`one of ${fp.enum.map(v => JSON.stringify(v)).join(', ')}`)
      if (fp.default !== undefined) extra.push(`default ${JSON.stringify(fp.default)}`)
      if (fp.minimum !== undefined) extra.push(`≥ ${fp.minimum}`)
      if (fp.maximum !== undefined) extra.push(`≤ ${fp.maximum}`)
      if (fp.minLength !== undefined) extra.push(`min length ${fp.minLength}`)
      if (fp.maxLength !== undefined) extra.push(`max length ${fp.maxLength}`)
      if (fp.pattern) extra.push(`pattern ${fp.pattern}`)
      if (fp.readOnly) extra.push('read-only')
      if (fp.nullable) extra.push('nullable')
      if (fp.deprecated) extra.push('deprecated')
      rows.push({
        name,
        depth,
        type: schemaLabel(p),
        required: required.has(name),
        description: String(fp.description ?? ''),
        extra
      })
      if (!(isObj(p) && p.$ref && !p.properties)) walk(p, depth + 1)
    }
  }

  walk(schema, 0)

  return rows
}

export const exampleText = (v: unknown) =>
  v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2)

// ── Try it ──────────────────────────────────────────────────────────────────

export type TryInput = {
  pathValues: Record<string, string>
  query: Array<[string, string]>
  headers: Array<[string, string]>
  body: string
}

/** Path params filled in (encoded), empty query values left out. */
export function buildTryPath(
  path: string,
  input: Pick<TryInput, 'pathValues' | 'query'>
): { path: string; missing: string[] } {
  const missing: string[] = []
  const filled = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = input.pathValues[name]

    if (!v) {
      missing.push(name)

      return `{${name}}`
    }

    return encodeURIComponent(v)
  })

  const q = new URLSearchParams()

  for (const [k, v] of input.query) if (k && v !== '') q.append(k, v)
  const qs = q.toString()

  return { path: qs ? `${filled}?${qs}` : filled, missing }
}

export function joinUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

// ── Form edits (on a copy of the parsed document) ───────────────────────────

export type OperationRef = { path: string; method: SpecMethod }

export function listOperations(doc: Json): Array<OperationRef & { summary: string; tags: string[] }> {
  const out: Array<OperationRef & { summary: string; tags: string[] }> = []

  for (const [path, item] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(item)) continue

    for (const m of SPEC_METHODS)
      if (isObj(item[m]))
        out.push({
          path,
          method: m,
          summary: String(item[m].summary ?? ''),
          tags: Array.isArray(item[m].tags) ? item[m].tags : []
        })
  }

  return out
}

const clone = <T>(v: T): T => structuredClone(v)

export function pathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'Start the path with /'
  if (/\s/.test(path)) return 'No spaces in a path'
  if (/\{[^}]*$|^[^{]*\}/.test(path) || /\{\}/.test(path)) return 'Close every {parameter}'

  return null
}

export function addOperation(doc: Json, ref: OperationRef, summary = ''): Json {
  const d = clone(doc)

  d.paths ??= {}
  d.paths[ref.path] ??= {}
  if (d.paths[ref.path][ref.method]) throw new Error(`${ref.method.toUpperCase()} ${ref.path} already exists`)
  const params = [...ref.path.matchAll(/\{([^}]+)\}/g)].map(m => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' }
  }))

  d.paths[ref.path][ref.method] = {
    summary: summary || `${ref.method.toUpperCase()} ${ref.path}`,
    ...(params.length ? { parameters: params } : {}),
    responses: { [ref.method === 'post' ? '201' : ref.method === 'delete' ? '204' : '200']: { description: 'OK' } }
  }

  return d
}

export function removeOperation(doc: Json, ref: OperationRef): Json {
  const d = clone(doc)

  delete d.paths?.[ref.path]?.[ref.method]
  if (d.paths?.[ref.path] && !SPEC_METHODS.some(m => d.paths[ref.path][m])) delete d.paths[ref.path]

  return d
}

/** Sets fields of one operation; undefined / "" removes optional text fields. */
export function updateOperation(
  doc: Json,
  ref: OperationRef,
  patch: Partial<{ summary: string; description: string; operationId: string; tags: string[]; deprecated: boolean }>
): Json {
  const d = clone(doc)
  const op = d.paths?.[ref.path]?.[ref.method]

  if (!isObj(op)) throw new Error('No such operation')

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)) delete op[k]
    else op[k] = v
  }

  return d
}

export type FormParam = {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required: boolean
  type: string
  description: string
}

/** The operation's own inline parameters as rows ($ref parameters are kept untouched). */
export function formParams(doc: Json, ref: OperationRef): FormParam[] {
  const op = doc.paths?.[ref.path]?.[ref.method]

  return (Array.isArray(op?.parameters) ? op.parameters : [])
    .filter((p: unknown) => isObj(p) && !p.$ref)
    .map((p: Json) => ({
      name: String(p.name ?? ''),
      in: p.in,
      required: p.required === true,
      type: String(p.schema?.type ?? 'string'),
      description: String(p.description ?? '')
    }))
}

export function setParams(doc: Json, ref: OperationRef, rows: FormParam[]): Json {
  const d = clone(doc)
  const op = d.paths?.[ref.path]?.[ref.method]

  if (!isObj(op)) throw new Error('No such operation')
  const refs = (Array.isArray(op.parameters) ? op.parameters : []).filter((p: unknown) => isObj(p) && p.$ref)
  const previous = new Map<string, Json>(
    (Array.isArray(op.parameters) ? op.parameters : [])
      .filter((p: unknown) => isObj(p) && !p.$ref)
      .map((p: Json) => [`${p.in}:${p.name}`, p])
  )

  const inline = rows
    .filter(r => r.name.trim())
    .map(r => {
      const prev = previous.get(`${r.in}:${r.name}`) ?? {}
      const schema = { ...(isObj(prev.schema) ? prev.schema : {}), type: r.type }

      return {
        ...prev,
        name: r.name.trim(),
        in: r.in,
        ...(r.required || r.in === 'path' ? { required: true } : { required: undefined }),
        ...(r.description ? { description: r.description } : { description: undefined }),
        schema
      }
    })
    .map(p => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)))

  const all = [...refs, ...inline]

  if (all.length) op.parameters = all
  else delete op.parameters

  return d
}

export type FormResponse = { code: string; description: string }

export function setResponses(doc: Json, ref: OperationRef, rows: FormResponse[]): Json {
  const d = clone(doc)
  const op = d.paths?.[ref.path]?.[ref.method]

  if (!isObj(op)) throw new Error('No such operation')
  const before = isObj(op.responses) ? op.responses : {}
  const next: Json = {}

  for (const r of rows)
    if (r.code.trim())
      next[r.code.trim()] = {
        ...(isObj(before[r.code]) ? before[r.code] : {}),
        description: r.description || 'Response'
      }
  op.responses = next

  return d
}

export function setInfo(doc: Json, info: { title: string; version: string; description: string }): Json {
  const d = clone(doc)

  d.info = { ...(isObj(d.info) ? d.info : {}), title: info.title, version: info.version }
  if (info.description) d.info.description = info.description
  else delete d.info.description

  return d
}

export function setServers(doc: Json, servers: Array<{ url: string; description: string }>): Json {
  const d = clone(doc)
  const list = servers
    .filter(s => s.url.trim())
    .map(s => ({ url: s.url.trim(), ...(s.description ? { description: s.description } : {}) }))

  if (list.length) d.servers = list
  else delete d.servers

  return d
}

// ── Problems -> lines ───────────────────────────────────────────────────────

/** Splits "paths./users/{id}.get.parameters[0]" into keys; path keys keep their dots. */
export function problemKeys(path: string): string[] {
  const keys: string[] = []
  let rest = path

  while (rest) {
    if (rest.startsWith('/')) {
      // A path key runs until ".<method>" / ".parameters" / end.
      const m =
        /^(\/.*?)(?=\.(?:get|put|post|delete|options|head|patch|trace|parameters|summary|description|servers)(?:\.|\[|$)|$)/.exec(
          rest
        )
      const key = m ? m[1] : rest

      keys.push(key)
      rest = rest.slice(key.length).replace(/^\./, '')
      continue
    }

    const m = /^([^.[]+)((?:\[\d+\])*)\.?/.exec(rest)

    if (!m) break
    keys.push(m[1])
    rest = rest.slice(m[0].length)
  }

  return keys
}

/** Best-effort 1-based line of a problem's location in YAML or JSON text; null when not found. */
export function problemLine(text: string, path: string): number | null {
  const lineMatch = /^line (\d+)$/.exec(path)

  if (lineMatch) return Number(lineMatch[1])
  if (!path) return null
  const lines = text.split('\n')
  let from = 0
  let found: number | null = null

  for (const key of problemKeys(path)) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^\\s*(?:-\\s+)?["']?${esc}["']?\\s*:`)
    let hit = -1

    for (let i = from; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hit = i
        break
      }
    }

    if (hit < 0) break
    found = hit + 1
    from = hit + 1
  }

  return found
}

export const severityVariant = (s: 'breaking' | 'warning' | 'info' | 'error') =>
  s === 'breaking' || s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info'

/** Badge backgrounds for white text (each ≥ 4.5:1 with #fff), readable on light and dark pages. */
export const methodColor = (m: string): string =>
  ({ GET: '#0f7a55', POST: '#2563c9', PUT: '#a16207', PATCH: '#7c3aed', DELETE: '#c2410c' })[m.toUpperCase()] ??
  '#475569'
