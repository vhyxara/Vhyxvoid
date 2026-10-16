// schema.org structured data as a <script type="application/ld+json">.

/** JSON for a <script> tag: "<" escaped so text can't close the tag. */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export function JsonLd({ data }: { data: unknown }) {
  if (!data || (Array.isArray(data) && !data.length)) return null

  return <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: scriptJson(data) }} />
}

export function faqJsonLd(items: Array<{ q: string; a: string }>) {
  const valid = items.filter(i => i.q?.trim() && i.a?.trim())

  return valid.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: valid.map(i => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) } : null
}

/** Breadcrumbs from the home page down to this one; the last crumb is the page itself. */
export function breadcrumbJsonLd(site: string, crumbs: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${site}${c.path}` }))
  }
}
