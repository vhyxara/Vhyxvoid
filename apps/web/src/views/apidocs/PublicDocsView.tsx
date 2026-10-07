'use client'

// Published API docs for readers (no login): the latest version or one
// picked from the list, a password form for protected docs, downloads, a
// light/dark switch, and try-it (to the linked mock through VhyxVoid, or
// from the reader's browser straight to the API's server).

import { useEffect, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import { Alert, Badge, Button, Skeleton, TextField } from '@vhyxui/react'

import SpecDocsView, { type TryHandler } from '@/components/apidocs/SpecDocsView'
import { PublicDocsError, publicDocsService } from '@/api/infrastructure/services/specs.service'
import { joinUrl } from '@/views/org/specs/specForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const
const tokenKey = (w: string, s: string) => `vv-docs-token:${w}/${s}`

function readToken(w: string, s: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(w, s))
  } catch {
    return null
  }
}

function writeToken(w: string, s: string, t: string) {
  try {
    sessionStorage.setItem(tokenKey(w, s), t)
  } catch {
    // Private mode: the token lives in memory for this page only.
  }
}

const THEME_KEY = 'vv-docs-theme'

/**
 * Light or dark for the docs page only. The app's brand theme on <html> is
 * near-black in both modes, so the page sets data-theme on its own wrapper,
 * which re-declares the vhyx colour tokens for everything inside it.
 */
function useDocsTheme(): ['light' | 'dark', (t: 'light' | 'dark') => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    let saved: string | null

    try {
      saved = localStorage.getItem(THEME_KEY)
    } catch {
      saved = null
    }

    setTheme(saved === 'light' || saved === 'dark' ? saved : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  }, [])

  return [
    theme,
    t => {
      setTheme(t)

      try {
        localStorage.setItem(THEME_KEY, t)
      } catch {
        // Not remembered in private mode; the switch still works.
      }
    }
  ]
}

export default function PublicDocsView({ workspace, slug }: { workspace: string; slug: string }) {
  const [token, setToken] = useState<string | null>(null)
  const [version, setVersion] = useState<number | undefined>(undefined)
  const [tokenRead, setTokenRead] = useState(false)

  useEffect(() => {
    setToken(readToken(workspace, slug))
    const v = Number(new URLSearchParams(window.location.search).get('version'))

    if (Number.isInteger(v) && v > 0) setVersion(v)
    setTokenRead(true)
  }, [workspace, slug])

  const { data, error, isLoading } = useQuery({
    queryKey: ['public-docs', workspace, slug, version ?? 'latest', token],
    queryFn: () => publicDocsService.get(workspace, slug, version, token),
    enabled: tokenRead,
    retry: false,
    staleTime: 30_000
  })

  useEffect(() => {
    if (data) document.title = `${data.model.title} — API docs`
  }, [data])

  const locked = error instanceof PublicDocsError && error.passwordRequired

  if (locked)
    return (
      <Unlock
        workspace={workspace}
        slug={slug}
        onToken={t => (writeToken(workspace, slug, t), setToken(t))}
        hadToken={!!token}
      />
    )

  if (error)
    return (
      <Shell>
        <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center', paddingBlock: 64 }}>
          <i className='tabler-book-off' style={{ fontSize: 40, ...muted }} aria-hidden />
          <h1 style={{ margin: 0, fontSize: 22 }}>
            {error instanceof PublicDocsError && error.status === 404 ? 'No docs here' : 'The docs could not be loaded'}
          </h1>
          <p style={muted}>
            {error instanceof PublicDocsError && error.status === 404
              ? 'The link may be wrong, or the docs are no longer shared.'
              : (error as Error).message}
          </p>
        </div>
      </Shell>
    )

  if (isLoading || !data)
    return (
      <Shell>
        <Skeleton height='3rem' />
        <Skeleton height='24rem' />
      </Shell>
    )

  const onTry: TryHandler = async (_op, req) => {
    if (data.canTry) {
      // A mock made from the spec answers at the operation paths (without the server URL's path).
      return publicDocsService.tryIt(
        workspace,
        slug,
        {
          method: req.method,
          path: req.path,
          headers: req.headers,
          ...(req.body !== undefined ? { body: req.body } : {})
        },
        token
      )
    }

    if (!req.server) throw new Error('The docs list no server to send to')
    const t0 = performance.now()
    let res: Response

    try {
      res = await fetch(joinUrl(req.server, req.path), {
        method: req.method,
        headers: req.headers,
        body: req.body,
        credentials: 'omit'
      })
    } catch {
      throw new Error(
        'The browser could not reach the server. It may not allow requests from this page (CORS), or it may be down.'
      )
    }

    const headers: Record<string, string> = {}

    res.headers.forEach((v, k) => (headers[k] = v))

    return { status: res.status, headers, body: await res.text(), ms: Math.round(performance.now() - t0) }
  }

  const latest = data.versions[0]?.number

  return (
    <Shell>
      <SpecDocsView
        model={data.model}
        onTry={onTry}
        tryNote={
          data.canTry
            ? 'Requests go to a mock of this API, so you can try freely.'
            : 'Requests go from your browser to the server you pick.'
        }
        toolbar={
          <div className='flex items-center gap-2 flex-wrap' style={{ fontSize: 13 }}>
            {data.versions.length > 1 ? (
              <select
                aria-label='Version'
                value={data.number}
                onChange={e => {
                  const v = Number(e.target.value)

                  setVersion(v === latest ? undefined : v)
                  const url = new URL(window.location.href)

                  if (v === latest) url.searchParams.delete('version')
                  else url.searchParams.set('version', String(v))
                  window.history.replaceState(null, '', url)
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'var(--vhyx-color-bg)',
                  color: 'inherit',
                  border: '1px solid var(--vhyx-color-border)'
                }}
              >
                {data.versions.map(v => (
                  <option key={v.number} value={v.number}>
                    v{v.number}
                    {v.version ? ` (${v.version})` : ''}
                    {v.number === latest ? ' — latest' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Badge variant='outline'>v{data.number}</Badge>
            )}
            {data.number !== latest && <Badge variant='warning'>older version</Badge>}
            <span style={muted}>Published {new Date(data.publishedAt).toLocaleDateString()}</span>
            <span style={{ marginInlineStart: 'auto' }} className='flex items-center gap-1'>
              <a href={publicDocsService.downloadUrl(workspace, slug, 'yaml', data.number, token)}>
                <Button size='sm' variant='ghost'>
                  OpenAPI YAML
                </Button>
              </a>
              <a href={publicDocsService.downloadUrl(workspace, slug, 'json', data.number, token)}>
                <Button size='sm' variant='ghost'>
                  JSON
                </Button>
              </a>
            </span>
          </div>
        }
      />
      {data.changes.length > 0 && (
        <details style={{ marginBlockStart: 32, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer' }}>What changed in v{data.number}</summary>
          <ul style={{ marginBlockStart: 8 }}>
            {data.changes.map((c, i) => (
              <li key={i}>
                <strong>{c.severity}</strong> {c.location}: {c.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <footer style={{ ...muted, fontSize: 12, marginBlockStart: 48, textAlign: 'center' }}>Docs by VhyxVoid</footer>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useDocsTheme()
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <div data-theme={theme} style={{ minBlockSize: '100vh', background: 'var(--vhyx-color-bg)', color: 'var(--vhyx-color-text)', colorScheme: theme }}>
      <div className='flex flex-col gap-4' style={{ maxInlineSize: 1280, marginInline: 'auto', padding: '16px 16px 48px' }}>
        <div className='flex justify-end'>
          <Button size='sm' variant='ghost' aria-label={`Switch to ${next} mode`} onClick={() => setTheme(next)}>
            <i className={theme === 'dark' ? 'tabler-sun' : 'tabler-moon'} aria-hidden />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Unlock({
  workspace,
  slug,
  onToken,
  hadToken
}: {
  workspace: string
  slug: string
  onToken: (t: string) => void
  hadToken: boolean
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Shell>
      <form
        className='flex flex-col gap-3'
        style={{ maxInlineSize: 380, marginInline: 'auto', paddingBlock: 64 }}
        onSubmit={async e => {
          e.preventDefault()
          setBusy(true)
          setError(null)

          try {
            const r = await publicDocsService.unlock(workspace, slug, password)

            if (r.token) onToken(r.token)
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <i className='tabler-lock' style={{ fontSize: 36, ...muted }} aria-hidden />
        <h1 style={{ margin: 0, fontSize: 22 }}>These docs are protected</h1>
        <p style={{ ...muted, margin: 0 }}>
          {hadToken ? 'The password changed or your access expired. ' : ''}Enter the password you were given.
        </p>
        <TextField
          name='password'
          type='password'
          label='Password'
          value={password}
          onChange={e => setPassword(e.target.value)}
          error={error ?? undefined}
          autoFocus
        />
        <Button type='submit' loading={busy} disabled={!password}>
          Open the docs
        </Button>
        {error && <Alert variant='danger'>{error}</Alert>}
      </form>
    </Shell>
  )
}

export function DocsByHost({ host }: { host: string }) {
  const { data, error } = useQuery({
    queryKey: ['docs-host', host],
    queryFn: () => publicDocsService.byHost(host),
    retry: false
  })

  if (error)
    return (
      <Shell>
        <div style={{ textAlign: 'center', paddingBlock: 64 }}>
          <h1 style={{ fontSize: 22 }}>No docs here</h1>
        </div>
      </Shell>
    )

  if (!data)
    return (
      <Shell>
        <Skeleton height='24rem' />
      </Shell>
    )

  return <PublicDocsView workspace={data.workspace} slug={data.slug} />
}
