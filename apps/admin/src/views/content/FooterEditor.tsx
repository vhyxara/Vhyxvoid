'use client'

// The website footer: columns of links, in display order. Drag a column or a
// link by its handle (or focus the handle and use Space + arrow keys) to
// reorder it; "Column" moves a link to another column. A link points at a
// CMS page (picked from the list; left out of the footer while that page is
// not published) or at any URL.
import { useMemo } from 'react'

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Alert, Button, SelectField, Switch, Text, TextField } from '@vhyxui/react'

import { usePlatformList } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'

export type FooterLink = { id: string; label: string; type: 'page' | 'url'; slug?: string; href?: string; newTab?: boolean }
export type FooterColumn = { id: string; title: string; links: FooterLink[] }
export type FooterData = { columns: FooterColumn[] }

export const MAX_COLUMNS = 6
export const MAX_LINKS = 12

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 9)}`

/** Same rule as the API's footer schema: https://, mailto:, or a path on this site. */
export function hrefProblem(href: string | undefined): string | null {
  if (!href) return 'Enter a URL'

  return /^(https?:\/\/\S+|mailto:\S+|\/(?![/\\])\S*)$/i.test(href) ? null : 'Use https://…, mailto:… or a path starting with /'
}

/** Move the dragged item to where it was dropped (columns, or links within one column). */
export function applyDrag(data: FooterData, activeId: string, overId: string): FooterData {
  if (activeId === overId) return data
  const colFrom = data.columns.findIndex(c => c.id === activeId)
  const colTo = data.columns.findIndex(c => c.id === overId)

  if (colFrom >= 0 && colTo >= 0) return { columns: arrayMove(data.columns, colFrom, colTo) }

  return {
    columns: data.columns.map(c => {
      const from = c.links.findIndex(l => l.id === activeId)
      const to = c.links.findIndex(l => l.id === overId)

      return from >= 0 && to >= 0 ? { ...c, links: arrayMove(c.links, from, to) } : c
    })
  }
}

function Handle({ label, listeners, attributes }: { label: string; listeners: any; attributes: any }) {
  return (
    <button type='button' className='footer-handle' aria-label={label} title='Drag to reorder' {...attributes} {...listeners}>
      ⠿
    </button>
  )
}

function LinkRow({
  link,
  columns,
  columnId,
  pages,
  onChange,
  onMove,
  onRemove
}: {
  link: FooterLink
  columns: FooterColumn[]
  columnId: string
  pages: Array<{ value: string; label: string }>
  onChange: (l: FooterLink) => void
  onMove: (toColumn: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: link.id })
  const problem = link.type === 'url' ? hrefProblem(link.href) : !link.slug ? 'Pick a page' : null
  const missingPage = link.type === 'page' && link.slug && !pages.some(p => p.value === link.slug)

  return (
    <li ref={setNodeRef} className='footer-link' data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Handle label={`Move link ${link.label || 'without a label'}`} listeners={listeners} attributes={attributes} />
      <div className='footer-link-fields'>
        <TextField name={`label-${link.id}`} label='Label' size='sm' value={link.label} onChange={e => onChange({ ...link, label: e.target.value })} error={!link.label.trim() ? 'Give the link a label' : undefined} />
        <SelectField
          name={`type-${link.id}`}
          label='Links to'
          size='sm'
          value={link.type}
          onValueChange={v => onChange(v === 'page' ? { ...link, type: 'page', href: undefined } : { ...link, type: 'url', slug: undefined })}
          options={[{ value: 'page', label: 'A page' }, { value: 'url', label: 'A URL' }]}
        />
        {link.type === 'page' ? (
          <SelectField
            name={`slug-${link.id}`}
            label='Page'
            size='sm'
            value={link.slug ?? ''}
            onValueChange={v => onChange({ ...link, slug: v })}
            options={[...(missingPage ? [{ value: link.slug!, label: `/${link.slug} (not found)` }] : []), ...pages]}
            placeholder='Pick a page'
            error={problem ?? undefined}
          />
        ) : (
          <TextField name={`href-${link.id}`} label='URL' size='sm' placeholder='https://… or /pricing' value={link.href ?? ''} onChange={e => onChange({ ...link, href: e.target.value })} error={problem ?? undefined} />
        )}
        <SelectField
          name={`column-${link.id}`}
          label='Column'
          size='sm'
          value={columnId}
          onValueChange={onMove}
          options={columns.map((c, i) => ({ value: c.id, label: c.title || `Column ${i + 1}` }))}
        />
        <label className='footer-newtab'>
          <Switch checked={!!link.newTab} onCheckedChange={c => onChange({ ...link, newTab: c })} aria-label='Open in a new tab' />
          <Text size='sm'>New tab</Text>
        </label>
      </div>
      <Button size='xs' variant='ghost' onClick={onRemove} aria-label={`Remove link ${link.label}`}>
        Remove
      </Button>
    </li>
  )
}

function ColumnCard({
  column,
  index,
  data,
  pages,
  onChange
}: {
  column: FooterColumn
  index: number
  data: FooterData
  pages: Array<{ value: string; label: string }>
  onChange: (d: FooterData) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id })
  const setColumn = (c: FooterColumn) => onChange({ columns: data.columns.map(x => (x.id === column.id ? c : x)) })

  return (
    <section ref={setNodeRef} className='footer-col' data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform), transition }} aria-label={`Footer column ${column.title || index + 1}`}>
      <div className='footer-col-head'>
        <Handle label={`Move column ${column.title || index + 1}`} listeners={listeners} attributes={attributes} />
        <TextField name={`title-${column.id}`} label='Column title' size='sm' value={column.title} onChange={e => setColumn({ ...column, title: e.target.value })} />
        <Button size='xs' variant='ghost' onClick={() => onChange({ columns: data.columns.filter(x => x.id !== column.id) })} aria-label={`Remove column ${column.title}`}>
          Remove column
        </Button>
      </div>
      <SortableContext items={column.links.map(l => l.id)} strategy={verticalListSortingStrategy}>
        <ol className='footer-links'>
          {column.links.map(link => (
            <LinkRow
              key={link.id}
              link={link}
              columns={data.columns}
              columnId={column.id}
              pages={pages}
              onChange={l => setColumn({ ...column, links: column.links.map(x => (x.id === l.id ? l : x)) })}
              onRemove={() => setColumn({ ...column, links: column.links.filter(x => x.id !== link.id) })}
              onMove={to =>
                onChange({
                  columns: data.columns.map(c =>
                    c.id === column.id ? { ...c, links: c.links.filter(x => x.id !== link.id) } : c.id === to ? { ...c, links: [...c.links, link].slice(0, MAX_LINKS) } : c
                  )
                })
              }
            />
          ))}
        </ol>
      </SortableContext>
      {column.links.length === 0 && (
        <Text size='sm' tone='muted'>
          No links yet. An empty column is not shown on the website.
        </Text>
      )}
      <div>
        <Button size='sm' variant='outline' disabled={column.links.length >= MAX_LINKS} onClick={() => setColumn({ ...column, links: [...column.links, { id: newId('l'), label: '', type: 'page', newTab: false }] })}>
          Add link
        </Button>
      </div>
    </section>
  )
}

export function FooterEditor({ value, onChange }: { value: FooterData; onChange: (d: FooterData) => void }) {
  const data: FooterData = { columns: value?.columns ?? [] }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const pagesQuery = usePlatformList('content', platformService.content, { kind: 'page', limit: 100 })

  const pages = useMemo(() => {
    const rows = (pagesQuery.data?.items ?? []) as Array<{ slug: string; title: string; status: string; kind: string }>
    const builtIn = ((pagesQuery.data?.extra?.available ?? []) as Array<{ slug: string; title: string; kind: string }>).filter(a => a.kind === 'page')
    const all = [...rows.filter(r => r.kind === 'page').map(r => ({ value: r.slug, label: `${r.title} (/${r.slug})${r.status === 'PUBLISHED' ? '' : ' — not published'}` })), ...builtIn.map(b => ({ value: b.slug, label: `${b.title} (/${b.slug}) — built-in` }))]

    return all.sort((a, b) => a.label.localeCompare(b.label))
  }, [pagesQuery.data])

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over) onChange(applyDrag(data, String(e.active.id), String(e.over.id)))
  }

  return (
    <div className='flex flex-col gap-4'>
      <Text size='sm' tone='muted'>
        Drag the ⠿ handles to reorder columns and links, or focus a handle and use Space and the arrow keys. Links to pages that are not published are left out of the website footer until they are.
      </Text>
      {pagesQuery.error && <Alert variant='warning'>The list of pages could not be loaded, so page links can't be picked right now.</Alert>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={data.columns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          <div className='footer-cols'>
            {data.columns.map((c, i) => (
              <ColumnCard key={c.id} column={c} index={i} data={data} pages={pages} onChange={onChange} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div>
        <Button variant='outline' disabled={data.columns.length >= MAX_COLUMNS} onClick={() => onChange({ columns: [...data.columns, { id: newId('c'), title: 'New column', links: [] }] })}>
          Add column
        </Button>
        {data.columns.length >= MAX_COLUMNS && (
          <Text size='sm' tone='muted' className='mbs-1'>
            The footer holds up to {MAX_COLUMNS} columns of {MAX_LINKS} links.
          </Text>
        )}
      </div>
    </div>
  )
}
