'use client'

// Emails: the words of the emails people get (verify address, reset
// password, invitations, trial and payment notices, newsletter
// confirmation). Each field falls back to the built-in wording when empty;
// {{variables}} are filled in when the email is sent. The preview shows the
// email as it will look, with sample values.
import { useEffect, useMemo, useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Badge, Button, Skeleton, Text, TextareaField, TextField, toast } from '@vhyxui/react'
import { useQuery } from '@tanstack/react-query'

import { usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { EditableEmail, EmailFields } from '@/api/platform/types'

const FIELDS: Array<{ key: keyof EmailFields; label: string; long?: boolean; hint?: string }> = [
  { key: 'subject', label: 'Subject' },
  { key: 'heading', label: 'Heading' },
  { key: 'body', label: 'Text', long: true, hint: 'A blank line starts a new paragraph. **Bold** for emphasis.' },
  { key: 'button', label: 'Button' },
  { key: 'note', label: 'Small print', long: true }
]

/** Variables used in the fields that the email doesn't have. */
export function unknownVariables(fields: Partial<EmailFields>, variables: Record<string, string>) {
  const used = Object.values(fields).flatMap(v => [...(v ?? '').matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)].map(m => m[1]))

  return [...new Set(used.filter(u => !(u in variables)))]
}

function Editor({ email }: { email: EditableEmail }) {
  const [fields, setFields] = useState<Partial<EmailFields>>(email.override)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const save = usePlatformMutation(['emails'], (f: Partial<EmailFields>) => platformService.saveEmail(email.key, f))
  const test = usePlatformMutation([], (f: Partial<EmailFields>) => platformService.testEmail(email.key, f))
  const unknown = unknownVariables(fields, email.variables)
  const changed = JSON.stringify(fields) !== JSON.stringify(email.override)

  // The preview follows the typing, a moment after it stops.
  useEffect(() => {
    if (unknown.length) return
    const t = setTimeout(() => {
      platformService
        .previewEmail(email.key, fields)
        .then(p => (setPreview(p), setError(null)))
        .catch((e: Error) => setError(e.message))
    }, 350)

    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.key, JSON.stringify(fields)])

  const run = (f: Partial<EmailFields>, message: string) =>
    save
      .mutateAsync(f)
      .then(() => toast.success(message))
      .catch((e: Error) => setError(e.message))

  return (
    <div className='emails-editor'>
      <div className='flex flex-col gap-3' style={{ minWidth: 0 }}>
        <div>
          <Text weight='semibold'>{email.label}</Text>
          <Text size='sm' tone='muted'>
            {email.description}
          </Text>
        </div>
        {FIELDS.map(f => {
          const props = {
            name: `email-${f.key}`,
            label: f.label,
            placeholder: email.defaults[f.key],
            hint: f.hint,
            value: fields[f.key] ?? '',
            onChange: (e: { target: { value: string } }) => setFields(x => ({ ...x, [f.key]: e.target.value }))
          }

          return f.long ? <TextareaField key={f.key} rows={f.key === 'body' ? 6 : 2} {...props} /> : <TextField key={f.key} {...props} />
        })}
        <div className='flex flex-col gap-1'>
          <Text size='sm' weight='medium'>
            Variables
          </Text>
          <div className='flex gap-1 flex-wrap'>
            {Object.entries(email.variables).map(([v, sample]) => (
              <button
                key={v}
                type='button'
                className='email-var'
                title={`e.g. ${sample} (click to copy)`}
                onClick={() => navigator.clipboard?.writeText(`{{${v}}}`).then(() => toast.success(`Copied {{${v}}}`))}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <Text size='xs' tone='muted'>
            Empty fields use the built-in wording, shown greyed out. The button links to {'{{url}}'}.
          </Text>
        </div>
        {unknown.length > 0 && <Alert variant='warning'>Not available in this email: {unknown.map(u => `{{${u}}}`).join(', ')}</Alert>}
        {error && <Alert variant='danger'>{error}</Alert>}
        <div className='flex gap-2 flex-wrap'>
          <Button disabled={!changed || unknown.length > 0} loading={save.isPending} onClick={() => run(fields, 'Saved: new emails use it')}>
            Save
          </Button>
          <Button variant='outline' disabled={unknown.length > 0} loading={test.isPending} onClick={() => test.mutateAsync(fields).then(r => toast.success(`Test sent to ${r.to}`)).catch((e: Error) => setError(e.message))}>
            Send me a test
          </Button>
          {email.edited && (
            <Button variant='ghost' onClick={() => (setFields({}), run({}, 'Back to the built-in wording'))}>
              Use built-in wording
            </Button>
          )}
        </div>
      </div>
      <div className='email-preview'>
        <Text size='xs' tone='muted'>
          Subject
        </Text>
        <Text weight='semibold'>{preview?.subject ?? '…'}</Text>
        {/* The email's own HTML, isolated: no scripts, no access to this page. */}
        {preview ? <iframe title='Email preview' sandbox='' srcDoc={preview.html} /> : <Skeleton height='28rem' />}
      </div>
    </div>
  )
}

export function EmailsView() {
  const emails = useQuery({ queryKey: ['platform', 'emails'], queryFn: platformService.emails })
  const [key, setKey] = useState<string | null>(null)
  const selected = useMemo(() => emails.data?.find(e => e.key === key) ?? emails.data?.[0], [emails.data, key])

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader title='Emails' description='The words of the emails people get. Change a subject, heading, text, button or small print; the design stays the same.' />
      {emails.error && <Alert variant='danger'>{(emails.error as Error).message}</Alert>}
      {!emails.data ? (
        <Skeleton height='30rem' />
      ) : (
        <div className='emails-layout'>
          <nav className='emails-list' aria-label='Emails'>
            {emails.data.map(e => (
              <button key={e.key} type='button' aria-current={selected?.key === e.key ? 'true' : undefined} onClick={() => setKey(e.key)}>
                <span>{e.label}</span>
                {e.edited && (
                  <Badge size='sm' variant='info'>
                    edited
                  </Badge>
                )}
              </button>
            ))}
          </nav>
          {selected && <Editor key={selected.key + JSON.stringify(selected.override)} email={selected} />}
        </div>
      )}
    </div>
  )
}
