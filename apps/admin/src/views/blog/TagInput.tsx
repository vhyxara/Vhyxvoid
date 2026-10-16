'use client'

// Tags as chips: type a name and press Enter or comma; existing tags are
// suggested (a native datalist, so it works with the keyboard and screen
// readers). A name that doesn't exist yet becomes a new tag when the post is
// saved. Backspace in an empty field removes the last chip.
import { useId, useState } from 'react'

import { Text } from '@vhyxui/react'

export const MAX_TAGS = 10

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/** Adds a tag unless it is empty, already there (any case) or past the limit. */
export function addTag(tags: string[], name: string): string[] {
  const n = name.replace(/,/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 40)

  if (!n || tags.some(t => same(t, n)) || tags.length >= MAX_TAGS) return tags

  return [...tags, n]
}

export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const inputId = useId()
  const unused = suggestions.filter(s => !value.some(v => same(v, s)))
  const isNew = draft.trim() && !suggestions.some(s => same(s, draft))

  const commit = (text = draft) => {
    // An existing tag typed in another case is that tag: show its own spelling.
    const existing = suggestions.find(s => same(s, text.replace(/,/g, ' ')))

    onChange(addTag(value, existing ?? text))
    setDraft('')
  }

  return (
    <div className='flex flex-col gap-1'>
      <label htmlFor={inputId} className='tag-input-label'>
        Tags
      </label>
      <div className='tag-input'>
        {value.map(t => (
          <span key={t} className='tag-chip'>
            {t}
            <button type='button' aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter(x => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          list={listId}
          value={draft}
          placeholder={value.length >= MAX_TAGS ? `Up to ${MAX_TAGS} tags` : value.length ? 'Add another…' : 'Type a tag, press Enter'}
          disabled={value.length >= MAX_TAGS}
          onChange={e => {
            const v = e.target.value

            // Picking a suggestion from the list adds it straight away.
            if (suggestions.some(s => s === v)) return commit(v)
            if (v.includes(',')) return commit(v)
            setDraft(v)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => draft.trim() && commit()}
        />
        <datalist id={listId}>
          {unused.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <Text size='xs' tone='muted'>
        {isNew ? `"${draft.trim()}" is new: it is created when you save.` : 'Pick an existing tag or type a new one.'}
      </Text>
    </div>
  )
}
