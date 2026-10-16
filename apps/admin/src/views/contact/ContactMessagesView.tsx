'use client'

// Messages sent through the website's contact form (a contact form block on a
// CMS page). Each one is also emailed to the support email setting; this is
// the record, for triage. Opening a new message marks it read.
import { useState } from 'react'

import { PageHeader } from '@vhyxui/blocks'
import { Alert, Button, Dialog, SelectField, Text, toast } from '@vhyxui/react'

import { usePlatformList, usePlatformMutation } from '@/api/platform/hooks'
import { platformService } from '@/api/platform/service'
import type { ContactMessage } from '@/api/platform/types'
import { ReasonDialog } from '@/components/ui/ReasonDialog'
import { ServerTable } from '@/components/ui/ServerTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/components/ui/format'
import { useListState } from '@/components/ui/useListState'

function copy(text: string) {
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success('Copied'))
    .catch(() => toast.danger('Copy failed; select the address instead'))
}

function MessageDialog({ message, onClose }: { message: ContactMessage; onClose: () => void }) {
  const setStatus = usePlatformMutation(['contact'], (status: ContactMessage['status']) => platformService.setContactStatus(message.id, status))
  const remove = usePlatformMutation(['contact'], () => platformService.deleteContactMessage(message.id))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const subject = message.subject ? `Re: ${message.subject}` : 'Your message'

  return (
    <>
      <Dialog open onOpenChange={o => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content style={{ maxInlineSize: 640 }}>
            <Dialog.Title>{message.subject || 'No subject'}</Dialog.Title>
            <Dialog.Description>
              From {message.name} · {formatDate(message.createdAt)}
              {message.page ? ` · on /${message.page}` : ''}
            </Dialog.Description>
            <div className='flex flex-col gap-3 mbs-3'>
              <div className='flex items-center gap-2 flex-wrap'>
                <Text size='sm' style={{ userSelect: 'all' }}>
                  {message.email}
                </Text>
                <Button size='xs' variant='ghost' onClick={() => copy(message.email)}>
                  Copy address
                </Button>
                <Button asChild size='xs' variant='outline'>
                  <a href={`mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(subject)}`}>Reply by email</a>
                </Button>
              </div>
              <div className='contact-message-body'>{message.message}</div>
              {message.userAgent && (
                <Text size='xs' tone='muted'>
                  Sent from {message.ip ?? 'an unknown address'} · {message.userAgent}
                </Text>
              )}
            </div>
            <Dialog.Footer>
              <Button variant='destructive' onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              {message.status !== 'NEW' && (
                <Button variant='ghost' onClick={() => setStatus.mutateAsync('NEW').then(onClose)}>
                  Mark unread
                </Button>
              )}
              {message.status !== 'ARCHIVED' ? (
                <Button variant='outline' loading={setStatus.isPending} onClick={() => setStatus.mutateAsync('ARCHIVED').then(() => (toast.success('Archived'), onClose()))}>
                  Archive
                </Button>
              ) : (
                <Button variant='outline' onClick={() => setStatus.mutateAsync('READ').then(onClose)}>
                  Move to inbox
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      {confirmDelete && (
        <ReasonDialog
          open
          onOpenChange={o => !o && setConfirmDelete(false)}
          title='Delete this message?'
          description='It is removed for good. The copy sent to the support email is not affected.'
          confirmLabel='Delete'
          destructive
          requireReason={false}
          onConfirm={() => remove.mutateAsync(undefined as never).then(() => (toast.success('Deleted'), onClose()))}
        />
      )}
    </>
  )
}

export function ContactMessagesView() {
  const { params, set, searchInput, setSearchInput } = useListState(['status'])
  const query = usePlatformList('contact', platformService.contactMessages, params)
  const markRead = usePlatformMutation(['contact'], (id: string) => platformService.setContactStatus(id, 'READ'))
  const [open, setOpen] = useState<ContactMessage | null>(null)
  const unread: number = query.data?.extra?.unread ?? 0

  const show = (m: ContactMessage) => {
    setOpen(m)
    if (m.status === 'NEW') markRead.mutate(m.id)
  }

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        title='Messages'
        description='Messages sent through the contact form on the website. Each one is also emailed to the support address in Settings.'
      />
      {unread > 0 && <Alert variant='info'>{unread === 1 ? '1 unread message.' : `${unread} unread messages.`}</Alert>}
      <ServerTable<ContactMessage>
        query={query}
        page={Number(params.page)}
        onPageChange={p => set({ page: p }, false)}
        search={{ value: searchInput, onChange: setSearchInput, placeholder: 'Name, email or text' }}
        toolbar={
          <div style={{ minInlineSize: 160 }}>
            <SelectField
              name='status'
              label='Show'
              size='sm'
              value={String(params.status ?? 'inbox')}
              onValueChange={v => set({ status: v === 'inbox' ? undefined : v })}
              options={[{ value: 'inbox', label: 'Inbox' }, { value: 'NEW', label: 'Unread' }, { value: 'READ', label: 'Read' }, { value: 'ARCHIVED', label: 'Archived' }]}
            />
          </div>
        }
        emptyTitle='No messages'
        emptyDescription='Add a contact form to a page (Website content → a page → "+ Contact form") and messages arrive here.'
        columns={[
          {
            key: 'name',
            header: 'From',
            cell: m => (
              <button type='button' className='contact-row-open' onClick={() => show(m)} data-unread={m.status === 'NEW' || undefined}>
                <span>{m.name}</span>
                <Text size='xs' tone='muted'>
                  {m.email}
                </Text>
              </button>
            )
          },
          {
            key: 'subject',
            header: 'Message',
            cell: m => (
              <div className='flex flex-col' style={{ minWidth: 0 }}>
                <Text size='sm' weight={m.status === 'NEW' ? 'semibold' : undefined}>
                  {m.subject || 'No subject'}
                </Text>
                <Text size='xs' tone='muted' className='contact-snippet'>
                  {m.message}
                </Text>
              </div>
            )
          },
          { key: 'page', header: 'Page', cell: m => (m.page ? `/${m.page}` : '—') },
          { key: 'status', header: 'Status', cell: m => <StatusBadge status={m.status} label={m.status === 'NEW' ? 'Unread' : undefined} /> },
          { key: 'createdAt', header: 'Received', cell: m => formatDate(m.createdAt) }
        ]}
      />
      {open && <MessageDialog message={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
