// Headings of a post: anchors (ids) for its ## and ### headings, and the
// table of contents built from them. The same slug rules run on the markdown
// (for the contents list) and on the rendered headings (rehypeHeadingIds),
// so every entry points at its heading.

export type TocItem = { depth: 2 | 3; text: string; id: string }

/** "Why replay?" → "why-replay"; repeats get -1, -2… like GitHub. */
export function makeSlugger() {
  const seen = new Map<string, number>()

  return (text: string) => {
    const base =
      text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section'
    const n = seen.get(base) ?? 0

    seen.set(base, n + 1)

    return n ? `${base}-${n}` : base
  }
}

/** Markdown inline syntax off a heading line: what the reader sees. */
const plain = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/\s+#+\s*$/, '')
    .trim()

/** The ## and ### headings of a markdown body, in order, outside code blocks. */
export function headingsOf(markdown: string): TocItem[] {
  const slug = makeSlugger()
  const out: TocItem[] = []
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    const f = line.match(/^\s*(```|~~~)/)

    if (f) {
      fence = fence === f[1] ? null : (fence ?? f[1])
      continue
    }

    if (fence) continue
    const h = line.match(/^(#{2,3})\s+(.+)$/)

    if (h) {
      const text = plain(h[2])

      if (text) out.push({ depth: h[1].length as 2 | 3, text, id: slug(text) })
    }
  }

  return out
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] }

const textOf = (n: HastNode): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join(''))

/** Rehype plugin: ids on h2/h3, from their text, with the same slugs as headingsOf. */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = makeSlugger()
    const walk = (n: HastNode) => {
      if (n.type === 'element' && (n.tagName === 'h2' || n.tagName === 'h3')) {
        const text = textOf(n).trim()

        if (text) n.properties = { ...n.properties, id: slug(text) }
      }

      n.children?.forEach(walk)
    }

    walk(tree)
  }
}
