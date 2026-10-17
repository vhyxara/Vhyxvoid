import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/blog/replay-is-here' }))

import { NewsletterBand, newsletterSource } from './Newsletter'

afterEach(() => vi.unstubAllGlobals())

describe('newsletter', () => {
  it('names where people signed up', () => {
    expect(newsletterSource('/')).toBe('home')
    expect(newsletterSource('/blog')).toBe('blog')
    expect(newsletterSource('/blog/replay-is-here')).toBe('post:replay-is-here')
    expect(newsletterSource('/blog/category/guides')).toBe('blog')
    expect(newsletterSource('/pricing')).toBe('pricing')
  })

  it('checks the address, posts it with its source, and says to check the inbox', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 202 }))

    vi.stubGlobal('fetch', fetch)
    render(<NewsletterBand settings={{ 'newsletter.title': 'Stay in the loop' }} />)
    expect(screen.getByRole('heading', { name: 'Stay in the loop' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(screen.getByRole('alert').textContent).toMatch(/valid email/)
    expect(fetch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ann@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/check ann@example.com/))
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ email: 'ann@example.com', source: 'post:replay-is-here' })
  })

  it('is hidden when switched off', () => {
    const { container } = render(<NewsletterBand settings={{ 'newsletter.enabled': false }} />)

    expect(container.innerHTML).toBe('')
  })
})
