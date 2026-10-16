// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { Editor } from '@tiptap/react'

import { imageProblem, linkProblem, pageExtensions } from './RichTextEditor'

const roundTrip = (md: string) => {
  const editor = new Editor({ extensions: pageExtensions(), content: md, contentType: 'markdown' })
  const out = editor.getMarkdown()

  editor.destroy()

  return out
}

describe('the page editor stores markdown', () => {
  it('keeps headings, emphasis, links, lists, quotes, code and tables through a load and save', () => {
    const md = [
      '# About us',
      '',
      'We build **tunnels** and *mocks*. Read the [docs](/docs) or [GitHub](https://github.com/vhyxara).',
      '',
      '## What we value',
      '',
      '- Privacy',
      '- Speed',
      '',
      '1. First',
      '2. Second',
      '',
      '> A quote.',
      '',
      '```',
      'npx @vhyxvoid/agent',
      '```',
      '',
      '| Plan | Price |',
      '| --- | --- |',
      '| Free | $0 |'
    ].join('\n')
    const out = roundTrip(md)

    for (const piece of ['# About us', '**tunnels**', '*mocks*', '[docs](/docs)', '[GitHub](https://github.com/vhyxara)', '## What we value', '- Privacy', '1. First', '> A quote.', 'npx @vhyxvoid/agent', '| Plan', '| Free']) expect(out, piece).toContain(piece)
    // Stable: saving twice gives the same text.
    expect(roundTrip(out)).toBe(out)
  })

  it('keeps the contact form marker exactly, on its own line', () => {
    const out = roundTrip('# Contact\n\nWrite to us.\n\n{{contact-form}}\n\nWe reply within a day.')

    expect(out.split('\n')).toContain('{{contact-form}}')
    expect(out).not.toMatch(/\\\{/)
    expect(out.indexOf('Write to us.')).toBeLessThan(out.indexOf('{{contact-form}}'))
    expect(out.indexOf('{{contact-form}}')).toBeLessThan(out.indexOf('We reply'))
  })

  it('does not turn raw HTML into markup the website would render', () => {
    const out = roundTrip('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>')

    expect(out).not.toMatch(/<script>|<img/)
  })

  it('keeps images with their description', () => {
    const out = roundTrip('Before\n\n![Dashboard screenshot](https://example.com/shot.png)\n\nAfter')

    expect(out).toContain('![Dashboard screenshot](https://example.com/shot.png)')
    for (const ok of ['https://example.com/a.png', '/images/a.png']) expect(imageProblem(ok), ok).toBeNull()
    for (const bad of ['http://example.com/a.png', 'data:image/png;base64,AAAA', 'javascript:x', '//evil/a.png']) expect(imageProblem(bad), bad).toBeTruthy()
  })

  it('accepts links the website can render, refuses the rest', () => {
    for (const ok of ['https://example.com', '/pricing', '#faq', 'mailto:hi@example.com']) expect(linkProblem(ok), ok).toBeNull()
    for (const bad of ['javascript:alert(1)', '//evil.example', 'evil.example']) expect(linkProblem(bad), bad).toBeTruthy()
  })
})
