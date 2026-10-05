import { ApiError, type ApiFieldError } from './errors'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>

export type HttpRequestConfig = {
  /** Path relative to `baseUrl`, or an absolute URL. */
  url: string
  method: HttpMethod
  /** Request body. Plain values are sent as JSON; FormData, Blob, URLSearchParams and strings as-is. */
  data?: unknown
  /** Query-string parameters. `undefined`, `null` and `''` are skipped; arrays repeat the key. */
  params?: Record<string, QueryValue>
  headers?: Record<string, string>
  /** Skips auth headers and the unauthorized handler (login, refresh, public content). */
  isPublic?: boolean
  signal?: AbortSignal
  /** Return the whole JSON body instead of unwrapping `data` (for responses with `meta`). */
  raw?: boolean
}

export type HttpClientConfig = {
  baseUrl: string | (() => string)
  getAuthHeaders?: () => Record<string, string> | undefined | Promise<Record<string, string> | undefined>
  /**
   * Called once when an authenticated request answers 401. Receives a `retry`
   * that re-sends the request with fresh auth headers (a second 401 throws).
   */
  onUnauthorized?: <T>(retry: () => Promise<T>) => Promise<T>
  /** Defaults to 'include' so the httpOnly refresh cookie travels. */
  credentials?: RequestCredentials
  /** Milliseconds before a request is aborted. Default 30 s; 0 disables. */
  timeoutMs?: number
  fetch?: typeof fetch
}

export type HttpClient = <T = unknown>(config: HttpRequestConfig) => Promise<T>

const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

export function buildUrl(base: string, url: string, params?: HttpRequestConfig['params']): string {
  const joined = isAbsolute(url) ? url : `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`

  if (!params) return joined
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) value.forEach(v => search.append(key, String(v)))
    else search.append(key, String(value))
  }

  const qs = search.toString()

  if (!qs) return joined

  return `${joined}${joined.includes('?') ? '&' : '?'}${qs}`
}

function isBodyInit(data: unknown): data is BodyInit {
  return (
    typeof data === 'string' ||
    (typeof FormData !== 'undefined' && data instanceof FormData) ||
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) ||
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data)
  )
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205 || res.headers.get('content-length') === '0') return undefined
  const text = await res.text()

  if (!text) return undefined
  const type = res.headers.get('content-type') ?? ''

  if (type.includes('json') || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

function toApiError(status: number, body: unknown, statusText: string): ApiError {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const message = typeof b.message === 'string' && b.message ? b.message : statusText || `Request failed (${status})`

    return new ApiError(status, message, {
      code: typeof b.code === 'string' ? b.code : undefined,
      errors: Array.isArray(b.errors) ? (b.errors as ApiFieldError[]) : undefined,
      requestId: typeof b.requestId === 'string' ? b.requestId : undefined,
      data: b.data
    })
  }

  return new ApiError(status, typeof body === 'string' && body ? body.slice(0, 300) : statusText || `Request failed (${status})`)
}

/** Unwraps `{ success, data }`; bodies without `data` (paginated `items`/`meta`) are returned whole. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in (body as object)) {
    return (body as { data: unknown }).data
  }

  return body
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const timeoutMs = config.timeoutMs ?? 30_000

  async function send<T>(req: HttpRequestConfig, allowUnauthorizedHook: boolean): Promise<T> {
    const base = typeof config.baseUrl === 'function' ? config.baseUrl() : config.baseUrl
    const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) }

    if (!req.isPublic && config.getAuthHeaders) Object.assign(headers, (await config.getAuthHeaders()) ?? {})

    let body: BodyInit | undefined

    if (req.data !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      if (isBodyInit(req.data)) {
        body = req.data
      } else {
        body = JSON.stringify(req.data)
        if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
      }
    }

    const controller = new AbortController()
    const onAbort = () => controller.abort(req.signal?.reason)

    if (req.signal) {
      if (req.signal.aborted) controller.abort(req.signal.reason)
      else req.signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined
    const doFetch = config.fetch ?? fetch
    let res: Response

    try {
      res = await doFetch(buildUrl(base, req.url, req.params), {
        method: req.method,
        headers,
        body,
        credentials: config.credentials ?? 'include',
        signal: controller.signal
      })
    } catch (err) {
      if (req.signal?.aborted) throw err
      const timedOut = controller.signal.aborted

      throw new ApiError(0, timedOut ? 'The request timed out. Please try again.' : 'Network error. Check your connection and try again.', {
        code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        cause: err
      })
    } finally {
      if (timer) clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
    }

    if (res.status === 401 && !req.isPublic && allowUnauthorizedHook && config.onUnauthorized) {
      // Drain the body so the connection can be reused.
      await res.text().catch(() => undefined)

      return config.onUnauthorized(() => send<T>(req, false))
    }

    const parsed = await readBody(res)

    if (!res.ok) throw toApiError(res.status, parsed, res.statusText)
    if (parsed && typeof parsed === 'object' && (parsed as { success?: unknown }).success === false) {
      throw toApiError(res.status, parsed, res.statusText)
    }

    return (req.raw ? parsed : unwrap(parsed)) as T
  }

  return <T = unknown>(req: HttpRequestConfig) => send<T>(req, true)
}
