'use client'

// Cloudflare Turnstile widget for the contact form. Loads Cloudflare's script
// once, renders the check into a div, and reports the token (or null when it
// expires or fails). reset() asks for a fresh token after a refused send,
// since a token can be used only once.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')

    s.src = SCRIPT
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
    s.onerror = () => {
      loading = null
      reject(new Error('Turnstile did not load'))
    }
    document.head.appendChild(s)
  })

  return loading
}

export type TurnstileHandle = { reset: () => void }

export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string | null) => void; onError?: () => void }>(function Turnstile({ siteKey, onToken, onError }, ref) {
  const el = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callbacks = useRef({ onToken, onError })

  callbacks.current = { onToken, onError }

  useImperativeHandle(ref, () => ({
    reset: () => {
      callbacks.current.onToken(null)
      if (widget.current) window.turnstile?.reset(widget.current)
    }
  }))

  useEffect(() => {
    let cancelled = false

    loadTurnstile()
      .then(api => {
        if (cancelled || !el.current || widget.current) return
        widget.current = api.render(el.current, {
          sitekey: siteKey,
          theme: 'auto',
          callback: (t: string) => callbacks.current.onToken(t),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null)
            callbacks.current.onError?.()
          }
        })
      })
      .catch(() => callbacks.current.onError?.())

    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  return <div ref={el} className='cf-turnstile' />
})
