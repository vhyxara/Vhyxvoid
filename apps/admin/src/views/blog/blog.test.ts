import { describe, expect, it } from 'vitest'

import type { BlogPostDetail } from '@/api/platform/types'
import { changesOf, draftOf } from './BlogPostEditorView'
import { MAX_TAGS, addTag } from './TagInput'

const post = {
  id: 'p1',
  slug: 'hello',
  title: 'Hello',
  excerpt: '',
  body: '# Hi',
  coverImageUrl: null,
  coverImageAlt: '',
  category: { id: 'c1', slug: 'news', name: 'News' },
  tags: [{ id: 't1', slug: 'js', name: 'JS' }],
  featured: false,
  authorName: 'Ada',
  seoTitle: null,
  seoDescription: null
} as unknown as BlogPostDetail

describe('blog tags input', () => {
  it('adds trimmed names once, ignoring case and commas', () => {
    expect(addTag([], '  Web   dev ')).toEqual(['Web dev'])
    expect(addTag(['Web dev'], 'web DEV')).toEqual(['Web dev'])
    expect(addTag(['a'], 'b,')).toEqual(['a', 'b'])
    expect(addTag(['a'], '   ')).toEqual(['a'])
    expect(addTag([], 'x'.repeat(60))[0]).toHaveLength(40)
  })

  it(`stops at ${MAX_TAGS} tags`, () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`)

    expect(addTag(full, 'one more')).toBe(full)
  })
})

describe('blog post save', () => {
  it('sends only what changed', () => {
    const before = draftOf(post)

    expect(changesOf(before, before)).toEqual({})
    expect(changesOf(before, { ...before, title: 'Hello again', tags: ['JS', 'Node'] })).toEqual({ title: 'Hello again', tags: ['JS', 'Node'] })
  })

  it('clears optional fields with null, not an empty string', () => {
    const before = draftOf(post)

    expect(changesOf(before, { ...before, category: '' })).toEqual({ category: null })
    expect(changesOf({ ...before, seoTitle: 'x', coverImageUrl: '/a.png' }, before)).toEqual({ seoTitle: null, coverImageUrl: null })
    // An empty excerpt is a value, not a clear.
    expect(changesOf({ ...before, excerpt: 'x' }, before)).toEqual({ excerpt: '' })
  })
})
