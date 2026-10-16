'use client'

// The contact form a CMS page shows where its markdown has a {{contact-form}}
// line. Posts to the API's public /contact (stored, emailed to support, and
// listed in the admin panel's Messages). The hidden "website" field is a trap
// for bots; people never see it. With a captcha site key (setting
// support.captchaSiteKey) the form also shows Cloudflare's Turnstile check.
import { useRef, useState, type FormEvent } from 'react'

import { Alert, Button, TextField, TextareaField } from '@vhyxui/react'

import styles from './marketing.module.css'
import { Turnstile, type TurnstileHandle } from './Turnstile'

type Errors = Partial<Record<'name' | 'email' | 'subject' | 'message', string>>

const API = (process.env.NEXT_PUBLIC_API_URL_LIVE ?? '').replace(/\/$/, '')

export function ContactForm({ page, enabled, supportEmail, captchaSiteKey }: { page: string; enabled: boolean; supportEmail: string; captchaSiteKey?: string }) {
  const [values, setValues] = useState({ name: '', email: '', subject: '', message: '', website: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [problem, setProblem] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaBroken, setCaptchaBroken] = useState(false)
  const captcha = useRef<TurnstileHandle>(null)

  if (!enabled) {
    return (
      <Alert variant='info' className={styles.contactForm}>
        Write to us at <strong>{supportEmail}</strong> and a person will reply.
      </Alert>
    )
  }

  if (state === 'sent') {
    return (
      <Alert variant='success' className={styles.contactForm} role='status'>
        Thanks, {values.name.split(' ')[0] || 'there'}. Your message is on its way, and we&apos;ll reply to {values.email}.
      </Alert>
    )
  }

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues(v => ({ ...v, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const local: Errors = {}

    if (!values.name.trim()) local.name = 'Enter your name'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) local.email = 'Enter a valid email address'
    if (values.message.trim().length < 10) local.message = 'Write at least a sentence'
    setErrors(local)
    if (Object.keys(local).length) return

    if (captchaSiteKey && !captchaToken) {
      setProblem(captchaBroken ? `The human check could not load. Check your connection or write to ${supportEmail}.` : 'Complete the check that you\'re human, then send again.')

      return
    }

    setState('sending')
    setProblem('')

    try {
      const res = await fetch(`${API}/public/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, page, ...(captchaToken ? { captchaToken } : {}) })
      })

      if (res.ok) return setState('sent')
      // A token works once: get a fresh one for the next try.
      captcha.current?.reset()
      const body = (await res.json().catch(() => null)) as { message?: string; errors?: Array<{ path: string[]; message: string }> } | null

      if (res.status === 400 && body?.errors?.length) {
        setErrors(Object.fromEntries(body.errors.map(x => [x.path[0], x.message])) as Errors)
        setState('idle')

        return
      }

      setProblem(res.status === 429 ? 'You have sent several messages in a short time. Try again in a few minutes.' : (body?.message ?? `Sending failed (${res.status}).`))
      setState('failed')
    } catch {
      setProblem(`We couldn't reach the server. Check your connection, or write to ${supportEmail}.`)
      setState('failed')
    }
  }

  return (
    <form className={styles.contactForm} onSubmit={submit} noValidate>
      <div className={styles.contactRow}>
        <TextField name='contact-name' label='Name' autoComplete='name' value={values.name} onChange={set('name')} error={errors.name} required />
        <TextField name='contact-email' label='Email' type='email' autoComplete='email' value={values.email} onChange={set('email')} error={errors.email} required />
      </div>
      <TextField name='contact-subject' label='Subject' value={values.subject} onChange={set('subject')} error={errors.subject} optional />
      <TextareaField name='contact-message' label='Message' rows={6} value={values.message} onChange={set('message')} error={errors.message} required />
      {captchaSiteKey && <Turnstile ref={captcha} siteKey={captchaSiteKey} onToken={setCaptchaToken} onError={() => setCaptchaBroken(true)} />}
      <div className={styles.contactTrap} aria-hidden='true'>
        <label htmlFor='contact-website'>Website</label>
        <input id='contact-website' name='website' tabIndex={-1} autoComplete='off' value={values.website} onChange={set('website')} />
      </div>
      {problem && <Alert variant='danger'>{problem}</Alert>}
      <div>
        <Button type='submit' disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send message'}
        </Button>
      </div>
    </form>
  )
}
