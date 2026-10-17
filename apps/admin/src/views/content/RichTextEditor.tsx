'use client'

// Rich text editing for CMS pages that stores MARKDOWN: the website renders
// pages with react-markdown and raw HTML switched off, so whatever is typed
// here can never inject a script, and revisions stay readable as diffs.
// Formatting markdown can't express (colours, fonts) is deliberately absent.
//
// A "Contact form" block is a node of its own, written out as a line holding
// only {{contact-form}} (packages/content CONTACT_FORM_MARKER); the website
// renders the form there.
import { useEffect, useRef, useState } from 'react'

import { EditorContent, Node, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'

import { MediaPickerDialog } from '@/views/media/MediaPicker'
import { Button, Text, TextareaField, TextField } from '@vhyxui/react'

/** Same as packages/content's CONTACT_FORM_MARKER (admin doesn't depend on that package). */
export const CONTACT_FORM_MARKER = '{{contact-form}}'

export const ContactFormBlock = Node.create({
  name: 'contactForm',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: 'div[data-contact-form]' }],
  renderHTML: () => ['div', { 'data-contact-form': '', class: 'rte-contact', contenteditable: 'false' }, 'Contact form — visitors enter their name, email, subject and message here.'],
  markdownTokenName: 'contactForm',
  markdownTokenizer: {
    name: 'contactForm',
    level: 'block',
    start: (src: string) => src.indexOf(CONTACT_FORM_MARKER),
    tokenize: (src: string) => {
      const m = /^\{\{contact-form\}\}[ \t]*(?:\n|$)/.exec(src)

      return m ? { type: 'contactForm', raw: m[0] } : undefined
    }
  },
  parseMarkdown: () => ({ type: 'contactForm' }),
  renderMarkdown: () => CONTACT_FORM_MARKER
})

/** The extensions a page body uses; also used by the tests to round-trip markdown. */
export const pageExtensions = () => [
  StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false, defaultProtocol: 'https' }, heading: { levels: [1, 2, 3, 4] } }),
  TableKit.configure({ table: { resizable: false } }),
  // Images by URL (https or a site path), stored as markdown ![alt](src). No base64: pages stay small.
  Image.configure({ inline: false, allowBase64: false }),
  ContactFormBlock,
  Markdown
]

/** Image sources the website shows: https and paths on the site. */
export function imageProblem(src: string): string | null {
  return /^(https:\/\/\S+|\/(?![/\\])\S*)$/i.test(src.trim()) ? null : 'Use an https:// address or a path starting with /'
}

/** Links the website renders: http(s), mailto:, and paths on the site (not "//host"). */
export function linkProblem(href: string): string | null {
  if (/^(https?:\/\/\S+|mailto:\S+|\/(?![/\\])\S*|#\S+)$/i.test(href.trim())) return null

  return 'Use https://…, mailto:…, a path starting with / or #section'
}

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type='button'
      className='rte-tool'
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [href, setHref] = useState<string>(editor.getAttributes('link').href ?? '')
  const problem = href ? linkProblem(href) : null

  const apply = () => {
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (!problem) editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
    else return
    onClose()
  }

  return (
    <div className='rte-linkbar'>
      <TextField
        name='rte-link'
        label='Link address'
        size='sm'
        placeholder='https://… or /pricing'
        value={href}
        onChange={e => setHref(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          }

          if (e.key === 'Escape') onClose()
        }}
        error={problem ?? undefined}
        autoFocus
      />
      <Button size='sm' onClick={apply} disabled={!!problem}>
        {href.trim() ? 'Apply' : 'Remove link'}
      </Button>
      <Button size='sm' variant='ghost' onClick={onClose}>
        Cancel
      </Button>
    </div>
  )
}

function ImageBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [src, setSrc] = useState('')
  const [alt, setAlt] = useState('')
  const [picking, setPicking] = useState(false)
  const problem = src ? imageProblem(src) : null

  const apply = () => {
    if (!src.trim() || problem) return
    editor.chain().focus().setImage({ src: src.trim(), alt: alt.trim() }).run()
    onClose()
  }

  return (
    <div className='rte-linkbar'>
      <TextField name='rte-image-src' label='Image address' size='sm' placeholder='https://… or /images/…' value={src} onChange={e => setSrc(e.target.value)} error={problem ?? undefined} autoFocus />
      <TextField
        name='rte-image-alt'
        label='Description (alt text)'
        size='sm'
        hint='What the image shows, for screen readers and search engines.'
        value={alt}
        onChange={e => setAlt(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          }
        }}
      />
      <Button size='sm' variant='outline' onClick={() => setPicking(true)}>
        Media library…
      </Button>
      <Button size='sm' onClick={apply} disabled={!src.trim() || !!problem}>
        Insert image
      </Button>
      <MediaPickerDialog
        open={picking}
        onClose={() => setPicking(false)}
        onPick={a => {
          setSrc(a.url)
          if (!alt.trim()) setAlt(a.alt)
        }}
      />
      <Button size='sm' variant='ghost' onClick={onClose}>
        Cancel
      </Button>
    </div>
  )
}

/** `contactForm`: offer the contact form block (CMS pages; not blog posts). */
export function RichTextEditor({ value, onChange, contactForm = true, label = 'Page content' }: { value: string; onChange: (markdown: string) => void; contactForm?: boolean; label?: string }) {
  const [source, setSource] = useState(false)
  const [linking, setLinking] = useState(false)
  const [imaging, setImaging] = useState(false)
  const last = useRef(value)

  const editor = useEditor({
    extensions: pageExtensions(),
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    editorProps: { attributes: { class: 'rte-body markdown-preview', 'aria-label': label } },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown()

      last.current = md
      onChange(md)
    }
  })

  // Outside changes (restoring a revision, editing the source) reload the editor.
  useEffect(() => {
    if (!editor || value === last.current) return
    last.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  if (!editor) return <div className='rte' style={{ minBlockSize: '24rem' }} />

  const is = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs)
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => fn(editor.chain().focus()).run()
  const hasForm = editor.getJSON().content?.some(n => n.type === 'contactForm')

  return (
    <div className='rte'>
      <div className='rte-toolbar' role='toolbar' aria-label='Formatting'>
        <Tool label='Heading 2' active={is('heading', { level: 2 })} disabled={source} onClick={run(c => c.toggleHeading({ level: 2 }))}>
          H2
        </Tool>
        <Tool label='Heading 3' active={is('heading', { level: 3 })} disabled={source} onClick={run(c => c.toggleHeading({ level: 3 }))}>
          H3
        </Tool>
        <span className='rte-sep' />
        <Tool label='Bold' active={is('bold')} disabled={source} onClick={run(c => c.toggleBold())}>
          <b>B</b>
        </Tool>
        <Tool label='Italic' active={is('italic')} disabled={source} onClick={run(c => c.toggleItalic())}>
          <i>I</i>
        </Tool>
        <Tool label='Strikethrough' active={is('strike')} disabled={source} onClick={run(c => c.toggleStrike())}>
          <s>S</s>
        </Tool>
        <Tool label='Inline code' active={is('code')} disabled={source} onClick={run(c => c.toggleCode())}>
          {'</>'}
        </Tool>
        <Tool label='Link' active={is('link')} disabled={source} onClick={() => setLinking(l => !l)}>
          Link
        </Tool>
        <span className='rte-sep' />
        <Tool label='Bulleted list' active={is('bulletList')} disabled={source} onClick={run(c => c.toggleBulletList())}>
          • List
        </Tool>
        <Tool label='Numbered list' active={is('orderedList')} disabled={source} onClick={run(c => c.toggleOrderedList())}>
          1. List
        </Tool>
        <Tool label='Quote' active={is('blockquote')} disabled={source} onClick={run(c => c.toggleBlockquote())}>
          Quote
        </Tool>
        <Tool label='Code block' active={is('codeBlock')} disabled={source} onClick={run(c => c.toggleCodeBlock())}>
          Code
        </Tool>
        <Tool label='Table' active={is('table')} disabled={source} onClick={run(c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>
          Table
        </Tool>
        <Tool label='Divider' disabled={source} onClick={run(c => c.setHorizontalRule())}>
          —
        </Tool>
        <Tool label='Image' disabled={source} onClick={() => (setImaging(i => !i), setLinking(false))}>
          Image
        </Tool>
        {contactForm && (
          <Tool label='Contact form' disabled={source || hasForm} onClick={run(c => c.insertContent({ type: 'contactForm' }))}>
            + Contact form
          </Tool>
        )}
        <span className='rte-sep' />
        <Tool label='Undo' disabled={source || !editor.can().undo()} onClick={run(c => c.undo())}>
          ↶
        </Tool>
        <Tool label='Redo' disabled={source || !editor.can().redo()} onClick={run(c => c.redo())}>
          ↷
        </Tool>
        <span className='rte-grow' />
        <Tool label='Edit the markdown source' active={source} onClick={() => setSource(s => !s)}>
          Markdown
        </Tool>
      </div>
      {is('table') && !source && (
        <div className='rte-subbar'>
          <Text size='sm' tone='muted'>
            Table:
          </Text>
          <Tool label='Add row' onClick={run(c => c.addRowAfter())}>
            + Row
          </Tool>
          <Tool label='Add column' onClick={run(c => c.addColumnAfter())}>
            + Column
          </Tool>
          <Tool label='Delete row' onClick={run(c => c.deleteRow())}>
            − Row
          </Tool>
          <Tool label='Delete column' onClick={run(c => c.deleteColumn())}>
            − Column
          </Tool>
          <Tool label='Delete table' onClick={run(c => c.deleteTable())}>
            Delete table
          </Tool>
        </div>
      )}
      {linking && !source && <LinkBar editor={editor} onClose={() => setLinking(false)} />}
      {imaging && !source && <ImageBar editor={editor} onClose={() => setImaging(false)} />}
      {source ? (
        <TextareaField
          name='body-markdown'
          label='Markdown'
          hint={contactForm ? `Raw HTML is not shown on the website. A line holding only ${CONTACT_FORM_MARKER} places the contact form.` : 'Raw HTML is not shown on the website.'}
          rows={24}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ fontFamily: 'var(--vhyx-font-mono, monospace)' }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  )
}
