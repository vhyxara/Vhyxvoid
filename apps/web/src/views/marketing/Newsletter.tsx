'use client'

// The newsletter: the sign-up band above the footer of every public page, and
// the two pages its emails link to (confirm, unsubscribe). Sign-ups are
// double opt-in: the API emails a confirmation link and sends nothing else
// until it is opened. The hidden "website" field is a trap for bots.
import { useEffect, useRef, useState, type FormEvent } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Button } from '@vhyxui/react'

import type { PublicSettings } from './publicApi'
import styles from './marketing.module.css'

const API = (process.env.NEXT_PUBLIC_API_URL_LIVE ?? '').replace(/\/$/, '')

/** Where on the site someone signed up: "home", "blog", "post:<slug>", "<page>". */
export function newsletterSource(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)

  if (!parts.length) return 'home'
  if (parts[0] === 'blog') return parts.length === 2 && !['category', 'tag', 'author'].includes(parts[1]) ? `post:${parts[1]}` : 'blog'

  return parts.join('/').slice(0, 80)
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}/public/newsletter${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const json = (await res?.json().catch(() => null)) as { message?: string; data?: { email?: string | null } } | null

  return { ok: !!res?.ok, status: res?.status ?? 0, message: json?.message, email: json?.data?.email ?? null }
}

export function NewsletterBand({ settings }: { settings: PublicSettings }) {
  const pathname = usePathname() ?? '/'
  const [email, setEmail] = useState('')
  const [trap, setTrap] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  if (settings['newsletter.enabled'] === false || pathname.startsWith('/newsletter')) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address')
    setError('')
    setState('sending')
    const r = await post('', { email: email.trim(), source: newsletterSource(pathname), website: trap || undefined })

    if (r.ok) return setState('sent')
    setState('idle')
    setError(r.status === 429 ? 'Too many tries. Wait a few minutes and try again.' : r.message || 'That didn’t work. Try again in a minute.')
  }

  return (
    <section className={styles.newsletter} aria-labelledby='newsletter-title'>
      <div className={styles.newsletterText}>
        <h2 id='newsletter-title'>{settings['newsletter.title'] || 'Get product updates'}</h2>
        <p>{settings['newsletter.description'] || 'New features and posts, about once a month. Unsubscribe any time.'}</p>
      </div>
      {state === 'sent' ? (
        <p className={styles.newsletterDone} role='status'>
          Almost there: check <strong>{email.trim()}</strong> and click the link to confirm.
        </p>
      ) : (
        <form className={styles.newsletterForm} onSubmit={submit} noValidate>
          <label htmlFor='newsletter-email' className={styles.srOnly}>
            Email address
          </label>
          <input
            id='newsletter-email'
            type='email'
            name='email'
            autoComplete='email'
            placeholder='you@company.com'
            value={email}
            onChange={e => setEmail(e.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'newsletter-error' : undefined}
            required
          />
          <input type='text' name='website' tabIndex={-1} autoComplete='off' aria-hidden className={styles.trap} value={trap} onChange={e => setTrap(e.target.value)} />
          <Button type='submit' loading={state === 'sending'}>
            Subscribe
          </Button>
          {error && (
            <p id='newsletter-error' className={styles.newsletterError} role='alert'>
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

/** /newsletter/confirm?token=: confirms in the browser (link scanners that only fetch the page don't). */
export function NewsletterConfirm({ token }: { token: string }) {
  const [r, setR] = useState<{ ok: boolean; message?: string } | null>(null)
  const once = useRef(false)

  useEffect(() => {
    if (once.current) return
    once.current = true
    if (!token) return setR({ ok: false, message: 'This link is incomplete. Open it straight from the email.' })
    void post('/confirm', { token }).then(setR)
  }, [token])

  return (
    <div className={styles.newsletterPage}>
      {!r ? (
        <h1>Confirming…</h1>
      ) : r.ok ? (
        <>
          <h1>You’re subscribed</h1>
          <p>Thanks. You’ll get product updates and new posts by email. Every email has a link to unsubscribe.</p>
          <Button asChild>
            <Link href='/blog'>Read the blog</Link>
          </Button>
        </>
      ) : (
        <>
          <h1>That link didn’t work</h1>
          <p>{r.message || 'It may have expired.'} You can sign up again at the bottom of any page.</p>
          <Button asChild variant='outline'>
            <Link href='/'>Go home</Link>
          </Button>
        </>
      )}
    </div>
  )
}

/** /newsletter/unsubscribe?token=: one button, so a link preview can't unsubscribe anyone. */
export function NewsletterUnsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle')
  const [message, setMessage] = useState('')

  async function go() {
    setState('sending')
    const r = await post('/unsubscribe', { token })

    setState(r.ok ? 'done' : 'failed')
    setMessage(r.message ?? '')
  }

  return (
    <div className={styles.newsletterPage}>
      {state === 'done' ? (
        <>
          <h1>You’re unsubscribed</h1>
          <p>You won’t get any more newsletter emails. Changed your mind? Sign up again at the bottom of any page.</p>
        </>
      ) : !token ? (
        <>
          <h1>Unsubscribe</h1>
          <p>Use the unsubscribe link at the bottom of one of our emails: it identifies your address.</p>
        </>
      ) : (
        <>
          <h1>Unsubscribe from updates?</h1>
          <p>You’ll stop getting product updates and new posts by email.</p>
          {state === 'failed' && (
            <p className={styles.newsletterError} role='alert'>
              {message || 'That didn’t work. Try again in a minute.'}
            </p>
          )}
          <Button onClick={go} loading={state === 'sending'}>
            Unsubscribe
          </Button>
        </>
      )}
    </div>
  )
}
