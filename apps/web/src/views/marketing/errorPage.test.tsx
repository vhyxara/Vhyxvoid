import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/pricing' }))
// The starfield draws on a canvas, which jsdom doesn't have.
vi.mock('@/views/marketing/void/Starfield', () => ({ Starfield: () => null }))

const { default: LocaleError } = await import('@/app/[locale]/error')

describe('the error page', () => {
  it('says what happened, shows the reference and retries', () => {
    const reset = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<LocaleError error={Object.assign(new Error('boom'), { digest: 'abc123' })} reset={reset} />)
    expect(screen.getByRole('heading', { name: 'Signal lost' })).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(screen.queryByText(/boom/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(reset).toHaveBeenCalled()
    spy.mockRestore()
  })
})
