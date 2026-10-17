import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { DEFAULT_CONTENT, type PricingContent } from '@vhyxvoid/content'

import { PricingView, offersYearly, shownPrice } from './PricingView'
import type { PublicPlans } from './publicApi'

const content = DEFAULT_CONTENT.find(e => e.slug === 'pricing')!.data as PricingContent
const plans = (yearly?: PublicPlans['yearly']): PublicPlans => ({ mode: 'paid', checkoutEnabled: true, trialDays: 0, yearly, plans: [] })

describe('yearly billing on the pricing page', () => {
  it('is offered only when a plan has a yearly price that can be bought', () => {
    expect(offersYearly(content, plans({ PRO: true, ENTERPRISE: false }))).toBe(true)
    expect(offersYearly(content, plans({ PRO: false, ENTERPRISE: false }))).toBe(false)
    expect(offersYearly(content, null)).toBe(true)
    expect(offersYearly({ ...content, plans: content.plans.map(p => ({ ...p, yearlyPrice: '' })) }, plans({ PRO: true, ENTERPRISE: true }))).toBe(false)
  })

  it('shows yearly prices where there are some, and the monthly ones elsewhere', () => {
    const pro = content.plans.find(p => p.plan === 'PRO')!
    const ent = content.plans.find(p => p.plan === 'ENTERPRISE')!

    expect(shownPrice(pro, true)).toEqual({ price: '$10', period: 'per month, billed yearly' })
    expect(shownPrice(pro, false)).toEqual({ price: '$12', period: 'per month' })
    expect(shownPrice(ent, true)).toEqual({ price: 'Custom', period: '' })
  })

  it('switches with the Monthly / Yearly control', () => {
    render(<PricingView content={content} plans={plans({ PRO: true, ENTERPRISE: false })} signupsEnabled />)
    expect(screen.getByText('$12')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Yearly/ }))
    expect(screen.getByText('$10')).toBeTruthy()
    expect(screen.getByText('2 months free')).toBeTruthy()
  })
})
