import type { InspectedBody, InspectedRequest } from '@/api/domain/inspector/inspector.types'

/** Readable text for a captured body: pretty JSON when it parses. */
export function prettyBody(body: InspectedBody, contentType?: string): { text: string; kind: 'json' | 'text' | 'binary' | 'empty' } {
  if (!body.data) return { text: '', kind: 'empty' }
  if (body.encoding === 'base64') return { text: `Binary body, ${formatBytes(body.size)}`, kind: 'binary' }
  const looksJson = (contentType ?? '').includes('json') || /^[\s]*[[{]/.test(body.data)

  if (looksJson && !body.truncated) {
    try {
      return { text: JSON.stringify(JSON.parse(body.data), null, 2), kind: 'json' }
    } catch {
      // not JSON after all
    }
  }

  if ((contentType ?? '').includes('x-www-form-urlencoded')) {
    try {
      const pairs = [...new URLSearchParams(body.data).entries()]

      return { text: pairs.map(([k, v]) => `${k} = ${v}`).join('\n'), kind: 'text' }
    } catch {
      // fall through
    }
  }

  return { text: body.data, kind: 'text' }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`

  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-proto'])

/** A curl command that sends the captured request again (hidden headers left out). */
export function toCurl(r: InspectedRequest): string {
  const host = r.host ?? `${r.accountSlug}--${r.label}`
  const parts = [`curl -X ${r.method} ${shellQuote(`https://${host}${r.path}`)}`]

  for (const [name, value] of Object.entries(r.request.headers)) {
    if (SKIP_HEADERS.has(name) || value === '[hidden]') continue
    parts.push(`-H ${shellQuote(`${name}: ${value}`)}`)
  }

  if (r.request.body.data && r.request.body.encoding === 'utf8') parts.push(`--data-raw ${shellQuote(r.request.body.data)}`)

  return parts.join(' \\\n  ')
}

/** Badge variant for an HTTP status. */
export function statusVariant(status: number | null, error: string | null): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  if (error || status === null) return 'danger'
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  if (status >= 300) return 'info'

  return 'success'
}
