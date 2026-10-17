import { describe, expect, it } from 'vitest'

import { brandAccentCss } from './brandStyle'

describe('brand accent', () => {
  it('sets the site and dashboard accent from one colour', () => {
    const css = brandAccentCss('#0EA5E9')

    expect(css).toContain('--brand-accent:#0ea5e9')
    expect(css).toContain('--vhyx-color-accent:#0ea5e9!important')
    expect(css).toContain('color-mix(in srgb, #0ea5e9 85%, black)')
  })

  it('is nothing for an empty or malformed value (never injects CSS)', () => {
    expect(brandAccentCss('')).toBe('')
    expect(brandAccentCss(undefined)).toBe('')
    expect(brandAccentCss('red;}body{display:none')).toBe('')
    expect(brandAccentCss('#12345')).toBe('')
  })
})
