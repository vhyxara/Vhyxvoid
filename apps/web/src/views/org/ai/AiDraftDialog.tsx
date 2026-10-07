'use client'

// "Draft with AI": describe an API (or pick captured traffic, or API docs for
// tests) and get mock endpoints or a test collection back. Nothing is saved
// here; onApply hands the draft to the editor that opened the dialog.

import { useState } from 'react'

import { useMutation, useQuery } from '@tanstack/react-query'

import { Alert, Button, Dialog, SelectField, TextareaField, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { aiService, type AiCollection } from '@/api/infrastructure/services/ai.service'
import { inspectorService } from '@/api/infrastructure/services/inspector.service'
import { specsService } from '@/api/infrastructure/services/specs.service'
import type { MockEndpoint } from '@/api/infrastructure/services/mocks.service'
import { aiUsageText, aiSourceProblem, type AiSourceChoice } from './aiForm'

const muted = { color: 'var(--vhyx-color-text-muted)' } as const

type Props =
  | { kind: 'mock'; accountId: string; mockId?: string; defaultLabel?: string; onClose: () => void; onApply: (r: { endpoints: MockEndpoint[]; summary: string; warnings: string[] }) => void | Promise<void> }
  | { kind: 'tests'; accountId: string; onClose: () => void; onApply: (r: { collection: AiCollection; summary: string; warnings: string[] }) => void | Promise<void> }

export default function AiDraftDialog(props: Props) {
  const { accountId, kind } = props
  const [source, setSource] = useState<AiSourceChoice>('description')
  const [description, setDescription] = useState('')
  const [label, setLabel] = useState(kind === 'mock' ? (props.defaultLabel ?? '') : '')
  const [specId, setSpecId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [applying, setApplying] = useState(false)

  const status = useQuery({ queryKey: ['ai', 'status', accountId], queryFn: () => aiService.status(accountId) })
  const tunnels = useQuery({ queryKey: ['ai', 'tunnels', accountId], queryFn: () => inspectorService.overview(accountId), enabled: source === 'traffic' })
  const specs = useQuery({ queryKey: ['ai', 'specs', accountId], queryFn: () => specsService.overview(accountId), enabled: source === 'spec' })

  const run = useMutation({
    mutationFn: async () => {
      const desc = description.trim() || undefined

      if (props.kind === 'mock') {
        const r = await aiService.mock(accountId, { description: desc, trafficLabel: source === 'traffic' ? label : undefined, mockId: props.mockId })

        setApplying(true)
        await props.onApply(r)

        return r
      }

      const r = await aiService.tests(accountId, { description: desc, trafficLabel: source === 'traffic' ? label : undefined, specId: source === 'spec' ? specId : undefined, baseUrl: baseUrl.trim() || undefined })

      setApplying(true)
      await props.onApply(r)

      return r
    },
    onSuccess: r => {
      toast.success(r.summary || 'Drafted')
      for (const w of r.warnings.slice(0, 3)) toast.info(w)
      props.onClose()
    },
    onError: e => {
      setApplying(false)
      toast.danger((e as Error).message)
    }
  })

  const s = status.data
  const problem = aiSourceProblem({ source, description, label, specId, baseUrl })
  const off = s && !s.available

  return (
    <Dialog open onOpenChange={next => !next && !run.isPending && props.onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{kind === 'mock' ? 'Draft endpoints with AI' : 'Draft tests with AI'}</Dialog.Title>
          <div className='flex flex-col gap-3'>
            {off && (
              <Alert variant='info'>
                {!s.enabled ? 'AI assist is switched off on this platform right now.' : !s.configured ? 'AI assist isn’t set up on this server yet.' : 'AI assist isn’t included in your plan.'}
              </Alert>
            )}
            <SelectField
              name='source'
              label='Based on'
              value={source}
              onValueChange={v => setSource(v as AiSourceChoice)}
              options={[
                { value: 'description', label: 'A description' },
                { value: 'traffic', label: 'Traffic captured on a tunnel' },
                ...(kind === 'tests' ? [{ value: 'spec', label: 'API docs in this workspace' }] : [])
              ]}
            />
            {source === 'traffic' && (
              <SelectField
                name='label'
                label='Tunnel'
                value={label}
                onValueChange={setLabel}
                placeholder={tunnels.isLoading ? 'Loading…' : tunnels.data?.tunnels.length ? 'Pick a tunnel' : 'No captured traffic yet'}
                options={(tunnels.data?.tunnels ?? []).map(t => ({ value: t.label, label: t.label }))}
                hint='The most recent requests the request inspector kept (credentials are never stored).'
              />
            )}
            {source === 'spec' && (
              <SelectField
                name='spec'
                label='API docs'
                value={specId}
                onValueChange={setSpecId}
                placeholder={specs.isLoading ? 'Loading…' : specs.data?.specs.length ? 'Pick API docs' : 'No API docs yet'}
                options={(specs.data?.specs ?? []).map(x => ({ value: x.id, label: x.name }))}
              />
            )}
            <TextareaField
              name='description'
              label={source === 'description' ? 'Describe the API' : 'Anything to add (optional)'}
              rows={6}
              maxLength={4000}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={
                kind === 'mock'
                  ? 'A bookstore API: list books with pagination, get a book by id (404 for unknown ids), create a book (400 without a title), and authors with their books.'
                  : 'Smoke tests for the users API: sign in, create a user, read it back, update the email, delete it, and check that unknown ids give 404.'
              }
            />
            {kind === 'tests' && <TextField name='baseUrl' label='Base URL (optional)' value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder='https://staging.example.com' hint='Saved as the {{baseUrl}} variable; change it in an environment later.' />}
            <Typography variant='caption' style={muted}>
              {kind === 'mock' ? 'New endpoints are added to the editor; review them and Save.' : 'A new collection is created with the draft; review it before you rely on it.'} What you enter{source === 'traffic' ? ' and the captured requests' : source === 'spec' ? ' and the docs' : ''} are sent to the AI provider. {s ? aiUsageText(s) : ''}
            </Typography>
          </div>
          <Dialog.Footer>
            <Button variant='secondary' type='button' onClick={props.onClose} disabled={run.isPending}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!!problem || !!off || status.isLoading} title={problem ?? undefined} icon={<i className='tabler-sparkles' />}>
              {applying ? 'Applying…' : run.isPending ? 'Drafting…' : 'Draft'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
