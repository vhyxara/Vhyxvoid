import { describe, expect, it } from 'vitest'

import { securityTxt } from '@/views/seo/securityTxt'

describe('security.txt', () => {
  const now = new Date('2026-10-17T12:00:00Z')

  it('publishes the security contact, else the support email, with an expiry a year out', () => {
    expect(securityTxt({ 'support.email': 'help@site.test' }, 'https://site.test', now)).toBe(
      'Contact: mailto:help@site.test\nExpires: 2027-10-17T00:00:00Z\nPreferred-Languages: en\nCanonical: https://site.test/.well-known/security.txt\n'
    )
    const custom = securityTxt({ 'support.email': 'help@site.test', 'support.securityContact': 'https://site.test/report', 'support.securityPolicyUrl': '/security' }, 'https://site.test', now)!

    expect(custom).toContain('Contact: https://site.test/report\n')
    expect(custom).toContain('Policy: https://site.test/security\n')
  })

  it('is nothing without any contact', () => {
    expect(securityTxt({}, 'https://site.test', now)).toBeNull()
  })
})
