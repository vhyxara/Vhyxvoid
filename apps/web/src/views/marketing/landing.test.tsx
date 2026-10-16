import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultEntry, type LandingContent } from '@vhyxvoid/content'

vi.mock('@vhyxchart/react', () => ({ VhyxChart: () => <div data-testid='chart' /> }))

const { LandingView } = await import('./LandingView')
const { Journey, STAGE_MS } = await import('./void/Journey')
const { splitStat } = await import('./void/hooks')

const content = defaultEntry('home')!.data as LandingContent

afterEach(() => vi.useRealTimers())

describe('the landing page', () => {
  it('renders every section from the content, with real stat values for search engines', () => {
    render(<LandingView content={content} signupsEnabled />)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(content.hero.title)
    expect(screen.getByRole('link', { name: /Start for free/ }).getAttribute('href')).toBe('/register')
    for (const s of content.stats) expect(screen.getByText(s.value)).toBeTruthy()
    for (const f of content.features.items) expect(screen.getByRole('heading', { name: f.title })).toBeTruthy()
    for (const step of content.steps.items) expect(screen.getByRole('heading', { name: step.title })).toBeTruthy()
    expect(screen.getByRole('heading', { name: content.journey!.title })).toBeTruthy()
    expect(screen.getByText(content.faq.items[0].q)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Create your free account/ })).toBeTruthy()
  })

  it('sends visitors to sign in when sign-ups are closed', () => {
    render(<LandingView content={content} signupsEnabled={false} />)

    expect(screen.getAllByRole('link', { name: /Sign in/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Start for free/ })).toBeNull()
  })

  it('falls back to the built-in journey for content saved before it existed', () => {
    const { journey: _j, ...old } = content

    render(<LandingView content={old as LandingContent} signupsEnabled />)
    expect(screen.getByRole('heading', { name: content.journey!.title })).toBeTruthy()
  })
})

describe('the journey of a request', () => {
  const stages = content.journey!.stages

  it('plays stop by stop, and a click takes over', () => {
    vi.useFakeTimers()
    render(<Journey title='T' subtitle='' stages={stages} />)

    expect(screen.getByRole('heading', { name: stages[0].title })).toBeTruthy()
    act(() => vi.advanceTimersByTime(STAGE_MS + 10))
    expect(screen.getByRole('heading', { name: stages[1].title })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(stages[1].node) }).getAttribute('aria-current')).toBe('step')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^4\\. ${stages[3].node}`) }))
    expect(screen.getByRole('heading', { name: stages[3].title })).toBeTruthy()
    act(() => vi.advanceTimersByTime(STAGE_MS * 3))
    expect(screen.getByRole('heading', { name: stages[3].title })).toBeTruthy() // paused after the click
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next stop' }))
    expect(screen.getByRole('heading', { name: stages[4].title })).toBeTruthy()
  })
})

describe('stat counting', () => {
  it('finds the number in a stat', () => {
    expect(splitStat('< 50 ms')).toEqual({ before: '< ', number: 50, decimals: 0, after: ' ms' })
    expect(splitStat('99.9%')).toEqual({ before: '', number: 99.9, decimals: 1, after: '%' })
    expect(splitStat('Free')).toBeNull()
  })
})
