import { describe, expect, it } from 'vitest'

import { sourceLabel } from './NewsletterView'

describe('newsletter sources', () => {
  it('read as places on the site', () => {
    expect(sourceLabel('post:replay-is-here')).toBe('Post: replay-is-here')
    expect(sourceLabel('home')).toBe('Home page')
    expect(sourceLabel('blog')).toBe('/blog')
    expect(sourceLabel('')).toBe('—')
  })
})
