import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { CONTACT_FORM_MARKER } from '@vhyxvoid/content'

import { ContactForm } from './ContactForm'
import styles from './marketing.module.css'

/** Splits a page's markdown around lines that hold only the contact form marker. */
export function splitAtContactForm(body: string): Array<{ kind: 'markdown'; text: string } | { kind: 'contact' }> {
  const parts: Array<{ kind: 'markdown'; text: string } | { kind: 'contact' }> = []
  let buf: string[] = []

  for (const line of body.split('\n')) {
    if (line.trim() === CONTACT_FORM_MARKER) {
      if (buf.join('\n').trim()) parts.push({ kind: 'markdown', text: buf.join('\n') })
      parts.push({ kind: 'contact' })
      buf = []
    } else buf.push(line)
  }

  if (buf.join('\n').trim()) parts.push({ kind: 'markdown', text: buf.join('\n') })

  return parts
}

/**
 * A CMS markdown page. Raw HTML in the markdown is not rendered
 * (react-markdown default), so admin content can't run scripts.
 */
export function MarkdownPage({ body, slug = '', contact }: { body: string; slug?: string; contact?: { enabled: boolean; supportEmail: string; captchaSiteKey?: string } }) {
  return (
    <section className={styles.section}>
      <article className={styles.prose}>
        {splitAtContactForm(body).map((part, i) =>
          part.kind === 'markdown' ? (
            <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
              {part.text}
            </ReactMarkdown>
          ) : (
            <ContactForm key={i} page={slug} enabled={contact?.enabled ?? true} supportEmail={contact?.supportEmail ?? 'support@vhyxvoid.com'} captchaSiteKey={contact?.captchaSiteKey || undefined} />
          )
        )}
      </article>
    </section>
  )
}
