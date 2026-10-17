import { describe, expect, it } from 'vitest'

import { headingsOf, makeSlugger, rehypeHeadingIds } from './toc'
import { shareLinks } from './PostExtras'
import { pageHref } from './BlogViews'

describe('post headings', () => {
  it('list ## and ### headings with GitHub-style ids, outside code blocks', () => {
    const md = ['# Title', '## Why **replay**?', 'text', '```md', '## not a heading', '```', '### Set up `npx` [here](/x)', '## Why replay?', '#### too deep'].join('\n')

    expect(headingsOf(md)).toEqual([
      { depth: 2, text: 'Why replay?', id: 'why-replay' },
      { depth: 3, text: 'Set up npx here', id: 'set-up-npx-here' },
      { depth: 2, text: 'Why replay?', id: 'why-replay-1' }
    ])
  })

  it('give rendered headings the same ids as the contents list', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'h2', children: [{ type: 'text', value: 'Why ' }, { type: 'element', tagName: 'strong', children: [{ type: 'text', value: 'replay' }] }, { type: 'text', value: '?' }] },
        { type: 'element', tagName: 'h2', children: [{ type: 'text', value: 'Why replay?' }] },
        { type: 'element', tagName: 'h4', children: [{ type: 'text', value: 'Deep' }] }
      ]
    } as any

    rehypeHeadingIds()(tree)
    expect(tree.children.map((c: any) => c.properties?.id)).toEqual(['why-replay', 'why-replay-1', undefined])
    expect(makeSlugger()('Écrire en français !')).toBe('ecrire-en-francais')
  })
})

describe('blog links', () => {
  it('keep the search across pages', () => {
    expect(pageHref('/blog', 1)).toBe('/blog')
    expect(pageHref('/blog', 2, 'web hooks')).toBe('/blog?q=web+hooks&page=2')
    expect(pageHref('/blog', 1, 'x')).toBe('/blog?q=x')
  })

  it('share the post address and title, encoded', () => {
    const links = shareLinks('https://a.test/blog/x?y=1', 'Hello & bye')

    expect(links.map(l => l.label)).toEqual(['X', 'LinkedIn', 'Reddit', 'Hacker News', 'Email'])
    expect(links[0].href).toBe('https://x.com/intent/post?url=https%3A%2F%2Fa.test%2Fblog%2Fx%3Fy%3D1&text=Hello%20%26%20bye')
  })
})
