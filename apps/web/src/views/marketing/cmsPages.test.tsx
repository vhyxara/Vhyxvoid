import type { ReactNode } from 'react'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// @vhyxui/react can't render under this repo's own React (cross-repo link:
// duplication; see Confirmation.test.tsx): plain stand-ins with the same props.
vi.mock('@vhyxui/react', () => {
  const Field = ({ name, label, error, multiline, ...rest }: any) => (
    <div>
      <label>
        {label}
        {multiline ? <textarea name={name} {...rest} /> : <input name={name} {...rest} />}
      </label>
      {error && <span role='alert'>{error}</span>}
    </div>
  )

  return {
    Alert: ({ children }: { children: ReactNode }) => <div role='status'>{children}</div>,
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    TextField: ({ optional: _o, ...p }: any) => <Field {...p} />,
    TextareaField: ({ optional: _o, ...p }: any) => <Field multiline {...p} />
  }
})

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('server-only', () => ({}))

import { revalidateTag } from 'next/cache'

import { ContactForm } from './ContactForm'
import { splitAtContactForm } from './MarkdownPage'
import { footerColumns } from './MarketingShell'
import { POST } from '@/app/api/revalidate/route'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.REVALIDATE_SECRET
})

describe('a page with a contact form block', () => {
  it('splits the markdown around lines holding only the marker', () => {
    expect(splitAtContactForm('# Contact\n\nWrite to us.\n\n{{contact-form}}\n\nWe reply within a day.')).toEqual([
      { kind: 'markdown', text: '# Contact\n\nWrite to us.\n' },
      { kind: 'contact' },
      { kind: 'markdown', text: '\nWe reply within a day.' }
    ])
    // Inside a sentence it is just text.
    expect(splitAtContactForm('Use {{contact-form}} here')).toEqual([{ kind: 'markdown', text: 'Use {{contact-form}} here' }])
  })
})

describe('the footer menu', () => {
  it('leaves out empty columns and marks new-tab links external', () => {
    expect(
      footerColumns({
        custom: true,
        columns: [
          { title: 'Company', links: [{ label: 'About', href: '/about', external: false }, { label: 'Jobs', href: 'https://jobs.example.com', external: true }] },
          { title: 'Empty', links: [] }
        ]
      })
    ).toEqual([{ title: 'Company', links: [{ label: 'About', href: '/about' }, { label: 'Jobs', href: 'https://jobs.example.com', external: true }] }])
  })
})

describe('POST /api/revalidate', () => {
  const call = (secret?: string, body: unknown = { tags: ['cms'] }) =>
    POST(new Request('http://web/api/revalidate', { method: 'POST', headers: secret ? { 'x-revalidate-secret': secret } : {}, body: JSON.stringify(body) }))

  it('is off without REVALIDATE_SECRET, refuses a wrong secret, and expires only known tags', async () => {
    expect((await call('x')).status).toBe(404)
    process.env.REVALIDATE_SECRET = 'right-secret'
    expect((await call()).status).toBe(403)
    expect((await call('wrong-secret')).status).toBe(403)
    expect(revalidateTag).not.toHaveBeenCalled()
    const ok = await call('right-secret', { tags: ['cms', 'something-else'] })

    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ revalidated: ['cms'] })
    expect(revalidateTag).toHaveBeenCalledWith('cms', { expire: 0 })
  })
})

describe('ContactForm', () => {
  it('checks the fields before sending, then sends with the page and thanks the person', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: '1' } }), { status: 202 }))

    vi.stubGlobal('fetch', fetchMock)
    render(<ContactForm page='contact' enabled supportEmail='help@example.com' />)
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Enter your name')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'I would like a demo, please.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText(/Thanks, Ada/)).toBeTruthy())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]

    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', page: 'contact', website: '' })
  })

  it('shows the API\'s field errors and a clear message when rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ path: ['email'], message: 'Enter a valid email address' }] }), { status: 400 })))
    const { unmount } = render(<ContactForm page='contact' enabled supportEmail='help@example.com' />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there, friends.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy()
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    render(<ContactForm page='contact' enabled supportEmail='help@example.com' />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there, friends.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText(/several messages in a short time/)).toBeTruthy()
  })

  it('switched off, it shows the support address instead', () => {
    render(<ContactForm page='contact' enabled={false} supportEmail='help@example.com' />)
    expect(screen.getByText('help@example.com')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
