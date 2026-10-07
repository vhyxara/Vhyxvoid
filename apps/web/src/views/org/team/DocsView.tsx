'use client'

// Team documents: folders and markdown pages. Create, move and rename here;
// open a document to edit it with a live preview.

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Alert, Button, Card, Dialog, SelectField, Skeleton, TextField, toast } from '@vhyxui/react'
import { PageHeader } from '@vhyxui/blocks'

import { useBootstrapReady } from '@/api/application/hooks/useBootstrapSession'
import { teamKeys, teamService, type DocsOverview, type Folder } from '@/api/infrastructure/services/team.service'
import { LiveDot, muted, useTeamSocket } from './TeamParts'
import { buildTree, dayLabel, descendants, type TreeNode } from './teamForm'

const TEMPLATES: Record<string, { title: string; body: string }> = {
  blank: { title: 'Untitled', body: '' },
  runbook: {
    title: 'Runbook: ',
    body: '# Runbook\n\n## When to use this\n\n## Steps\n\n1. \n2. \n\n## Rollback\n\n## Who to call\n'
  },
  rfc: {
    title: 'RFC: ',
    body: '# RFC\n\n## Problem\n\n## Proposal\n\n## API changes\n\nLink the spec: paste its API docs link here.\n\n## Alternatives\n\n## Open questions\n'
  },
  meeting: {
    title: `Notes ${new Date().toISOString().slice(0, 10)}`,
    body: '# Meeting notes\n\n## Attendees\n\n## Decisions\n\n## Action items\n\n- [ ] \n'
  }
}

export default function DocsView({ accountId }: { accountId: string }) {
  const ready = useBootstrapReady()
  const {
    data: o,
    isLoading,
    error
  } = useQuery({ queryKey: teamKeys.docs(accountId), queryFn: () => teamService.docs(accountId), enabled: ready })
  const socket = useTeamSocket(accountId, ready && !!o?.enabled)
  const [dialog, setDialog] = useState<
    | { kind: 'doc'; folderId: string | null }
    | { kind: 'folder'; parentId: string | null }
    | { kind: 'edit'; folder: Folder }
    | null
  >(null)
  const [q, setQ] = useState('')

  if (error) return <Alert variant='danger'>{(error as Error).message}</Alert>

  const filtered = o && q ? { ...o, docs: o.docs.filter(d => d.title.toLowerCase().includes(q.toLowerCase())) } : o
  const tree = filtered ? buildTree(filtered.folders, filtered.docs) : null
  const atLimit = !!o && o.limits.docs >= o.limits.maxDocs

  return (
    <div className='flex flex-col gap-4'>
      <PageHeader
        title='Docs'
        description='Runbooks, RFCs and notes next to your APIs. Markdown with a live preview, version history and comments; paste a link to a mock, request, run or issue and it shows as a card.'
      />
      <div className='flex items-center gap-2 flex-wrap'>
        {o?.enabled && <LiveDot status={socket.status} />}
        <div style={{ flex: '1 1 14rem' }}>
          <TextField name='filter' label='Filter by title' size='sm' value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Button
          onClick={() => setDialog({ kind: 'doc', folderId: null })}
          disabled={!o?.enabled || atLimit}
          icon={<i className='tabler-file-plus' />}
        >
          New document
        </Button>
        <Button
          variant='outline'
          onClick={() => setDialog({ kind: 'folder', parentId: null })}
          disabled={!o?.enabled}
          icon={<i className='tabler-folder-plus' />}
        >
          New folder
        </Button>
      </div>
      {o && !o.enabled && <Alert variant='info'>Read-only: the team space is off here or not on your plan.</Alert>}
      {atLimit && (
        <Alert variant='warning'>
          You have {o!.limits.docs} of {o!.limits.maxDocs} documents. Delete some or upgrade to add more.
        </Alert>
      )}
      {isLoading || !tree ? (
        <Skeleton height='16rem' />
      ) : !tree.children.length && !tree.docs.length ? (
        <Card className='p-8'>
          <div className='flex flex-col items-center gap-2' style={{ textAlign: 'center' }}>
            <i className='tabler-file-text' style={{ fontSize: 36, ...muted }} aria-hidden />
            <strong>{q ? 'No document matches' : 'No documents yet'}</strong>
            {!q && <span style={muted}>Start with a runbook or an RFC for your next API change.</span>}
          </div>
        </Card>
      ) : (
        <Card className='p-2'>
          <Tree
            accountId={accountId}
            node={tree}
            depth={0}
            onNew={folderId => setDialog({ kind: 'doc', folderId })}
            onFolder={parentId => setDialog({ kind: 'folder', parentId })}
            onEdit={folder => setDialog({ kind: 'edit', folder })}
            writable={!!o?.enabled}
          />
        </Card>
      )}
      {dialog?.kind === 'doc' && o && (
        <NewDocDialog accountId={accountId} o={o} folderId={dialog.folderId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'folder' && (
        <FolderDialog accountId={accountId} o={o!} parentId={dialog.parentId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'edit' && (
        <FolderDialog accountId={accountId} o={o!} folder={dialog.folder} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function Tree({
  accountId,
  node,
  depth,
  onNew,
  onFolder,
  onEdit,
  writable
}: {
  accountId: string
  node: TreeNode
  depth: number
  onNew: (folderId: string | null) => void
  onFolder: (parentId: string | null) => void
  onEdit: (f: Folder) => void
  writable: boolean
}) {
  const [open, setOpen] = useState(true)
  const pad = { paddingInlineStart: 8 + depth * 18 }

  return (
    <div role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Documents' : undefined}>
      {node.folder && (
        <div
          className='flex items-center gap-2'
          style={{ ...pad, paddingBlock: 4 }}
          role='treeitem'
          aria-expanded={open}
        >
          <button
            type='button'
            onClick={() => setOpen(x => !x)}
            className='flex items-center gap-2'
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14
            }}
          >
            <i
              className={open ? 'tabler-folder-open' : 'tabler-folder'}
              aria-hidden
              style={{ color: 'var(--vhyx-color-accent)' }}
            />
            {node.folder.name}
          </button>
          {writable && (
            <span className='flex gap-1' style={{ marginInlineStart: 'auto' }}>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onNew(node.folder!.id)}
                aria-label={`New document in ${node.folder.name}`}
              >
                <i className='tabler-file-plus' aria-hidden />
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onFolder(node.folder!.id)}
                aria-label={`New folder in ${node.folder.name}`}
              >
                <i className='tabler-folder-plus' aria-hidden />
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onEdit(node.folder!)}
                aria-label={`Rename or move ${node.folder.name}`}
              >
                <i className='tabler-pencil' aria-hidden />
              </Button>
            </span>
          )}
        </div>
      )}
      {open && (
        <>
          {node.children.map(c => (
            <Tree
              key={c.folder!.id}
              accountId={accountId}
              node={c}
              depth={node.folder ? depth + 1 : depth}
              onNew={onNew}
              onFolder={onFolder}
              onEdit={onEdit}
              writable={writable}
            />
          ))}
          {node.docs.map(d => (
            <Link
              key={d.id}
              href={`/organizations/${accountId}/team/docs/${d.id}`}
              role='treeitem'
              className='flex items-center gap-2'
              style={{
                paddingInlineStart: 8 + (node.folder ? depth + 1 : depth) * 18,
                paddingBlock: 6,
                color: 'inherit',
                borderRadius: 6
              }}
            >
              <i className='tabler-file-text' aria-hidden style={muted} />
              <span
                style={{
                  flex: 1,
                  minInlineSize: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {d.title}
              </span>
              <span style={{ ...muted, fontSize: 12, whiteSpace: 'nowrap' }}>
                {d.updatedBy ? `${d.updatedBy}, ` : ''}
                {dayLabel(d.updatedAt).toLowerCase()}
              </span>
            </Link>
          ))}
        </>
      )}
    </div>
  )
}

function folderOptions(o: DocsOverview, exclude?: Set<string>) {
  const tree = buildTree(o.folders, [])
  const out: Array<{ value: string; label: string }> = [{ value: 'root', label: 'Top level' }]
  const walk = (n: TreeNode, prefix: string) =>
    n.children.forEach(c => {
      if (exclude?.has(c.folder!.id)) return
      out.push({ value: c.folder!.id, label: `${prefix}${c.folder!.name}` })
      walk(c, `${prefix}${c.folder!.name} / `)
    })

  walk(tree, '')

  return out
}

function NewDocDialog({
  accountId,
  o,
  folderId,
  onClose
}: {
  accountId: string
  o: DocsOverview
  folderId: string | null
  onClose: () => void
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const [template, setTemplate] = useState('blank')
  const [title, setTitle] = useState(TEMPLATES.blank.title)
  const [folder, setFolder] = useState(folderId ?? 'root')
  const create = useMutation({
    mutationFn: () =>
      teamService.createDoc(accountId, {
        title: title.trim(),
        folderId: folder === 'root' ? null : folder,
        body: TEMPLATES[template].body
      }),
    onSuccess: d => {
      qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) })
      router.push(`/organizations/${accountId}/team/docs/${d.id}`)
    },
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='md'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>New document</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (title.trim()) create.mutate()
            }}
          >
            <SelectField
              name='template'
              label='Start from'
              value={template}
              onValueChange={v => {
                setTemplate(v)
                setTitle(TEMPLATES[v].title)
              }}
              options={[
                { value: 'blank', label: 'Blank page' },
                { value: 'runbook', label: 'Runbook' },
                { value: 'rfc', label: 'API change RFC' },
                { value: 'meeting', label: 'Meeting notes' }
              ]}
            />
            <TextField name='title' label='Title' value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            <SelectField
              name='folder'
              label='Folder'
              value={folder}
              onValueChange={setFolder}
              options={folderOptions(o)}
            />
            <Dialog.Footer>
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={create.isPending} disabled={!title.trim()}>
                Create
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function FolderDialog({
  accountId,
  o,
  parentId,
  folder,
  onClose
}: {
  accountId: string
  o: DocsOverview
  parentId?: string | null
  folder?: Folder
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(folder?.name ?? '')
  const [parent, setParent] = useState(folder ? (folder.parentId ?? 'root') : (parentId ?? 'root'))
  const done = () => (qc.invalidateQueries({ queryKey: teamKeys.docs(accountId) }), onClose())
  const save = useMutation({
    mutationFn: () =>
      folder
        ? teamService.updateFolder(accountId, folder.id, {
            name: name.trim(),
            parentId: parent === 'root' ? null : parent
          })
        : teamService.createFolder(accountId, name.trim(), parent === 'root' ? null : parent),
    onSuccess: done,
    onError: e => toast.danger((e as Error).message)
  })
  const del = useMutation({
    mutationFn: () => teamService.deleteFolder(accountId, folder!.id),
    onSuccess: done,
    onError: e => toast.danger((e as Error).message)
  })

  return (
    <Dialog open onOpenChange={x => !x && onClose()} size='sm'>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>{folder ? 'Folder' : 'New folder'}</Dialog.Title>
          <form
            className='flex flex-col gap-3'
            onSubmit={e => {
              e.preventDefault()
              if (name.trim()) save.mutate()
            }}
          >
            <TextField name='name' label='Name' value={name} onChange={e => setName(e.target.value)} autoFocus />
            <SelectField
              name='parent'
              label='Inside'
              value={parent}
              onValueChange={setParent}
              options={folderOptions(o, folder ? descendants(o.folders, folder.id) : undefined)}
            />
            <Dialog.Footer>
              {folder && (
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() =>
                    window.confirm('Remove this folder? Its documents and folders move up one level.') && del.mutate()
                  }
                >
                  Remove folder
                </Button>
              )}
              <Button variant='secondary' type='button' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' loading={save.isPending} disabled={!name.trim()}>
                Save
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
