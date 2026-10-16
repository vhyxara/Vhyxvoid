import { describe, expect, it } from 'vitest'

import { isAppPath } from './TeamParts'

// Markdown links in chat, docs and issues: "/x" opens in the app, while "//host"
// and "/\host" are other sites to a browser and must not pass as app paths.
describe('isAppPath', () => {
  it('tells app paths from protocol-relative URLs', () => {
    for (const p of ['/', '/organizations/1/team/docs/2', '/a//b']) expect(isAppPath(p)).toBe(true)
    for (const p of ['//evil.example/login', '/\\evil.example', 'https://x', 'javascript:alert(1)', '']) expect(isAppPath(p)).toBe(false)
  })
})
