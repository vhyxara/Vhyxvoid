import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import styles from './marketing.module.css'

/** A CMS markdown page. Raw HTML in the markdown is not rendered (react-markdown default). */
export function MarkdownPage({ body }: { body: string }) {
  return (
    <section className={styles.section}>
      <article className={styles.prose}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </article>
    </section>
  )
}
