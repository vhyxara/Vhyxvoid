'use client'
import { Alert, Badge, Button, Drawer } from '@vhyxui/react'

import { Skeleton, Typography } from '@/components/vhyxui-shims'
import { useFeedbackDetail } from '@/api/application/hooks/useFeedback'
import { typeLabel, typeColor, statusColor, priorityColor, feedbackBadgeVariant } from '@/utils/feedback.util'

// ── Field row ─────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null

  return (
    <div>
      <Typography
        variant='caption'
        style={{
          color: 'var(--vhyx-color-text-subtle)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          display: 'block'
        }}
      >
        {label}
      </Typography>
      <Typography variant='body2' style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
        {value}
      </Typography>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────

type Props = {
  feedbackId: string | null
  onClose: () => void
}

export function FeedbackDetailDrawer({ feedbackId, onClose }: Props) {
  const { data, isLoading } = useFeedbackDetail(feedbackId ?? '')

  return (
    <Drawer open={!!feedbackId} onOpenChange={next => !next && onClose()} side='right' size='md'>
      {/* Drawer.Portal gates rendering on open state — same requirement as
          Dialog.Portal, see decision.md, 2026-09-10/11, "Step 5b:
          Dialog.Portal omission". */}
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content>
          <Drawer.Header
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--vhyx-color-border)',
              paddingBottom: 'var(--vhyx-space-4)'
            }}
          >
            <Drawer.Title>Feedback detail</Drawer.Title>
            <Button
              variant='ghost'
              size='sm'
              iconOnly
              aria-label='Close'
              icon={<i className='tabler-x' />}
              onClick={onClose}
            />
          </Drawer.Header>

          {isLoading ? (
            <div className='flex flex-col gap-4'>
              <Skeleton variant='rectangular' height={28} width='60%' />
              <Skeleton variant='rectangular' height={20} width='40%' />
              <Skeleton variant='rectangular' height={80} />
              <Skeleton variant='rectangular' height={60} />
            </div>
          ) : !data ? null : (
            <div className='flex flex-col gap-6'>
              {/* ── Title + badges ── */}
              <div>
                <Typography variant='h6' style={{ fontWeight: 600, marginBottom: 8 }}>
                  {data.title}
                </Typography>
                <div className='flex flex-wrap gap-2'>
                  <Badge variant={feedbackBadgeVariant(typeColor(data.type))} size='sm'>
                    {typeLabel(data.type)}
                  </Badge>
                  <Badge variant={feedbackBadgeVariant(statusColor(data.status))} size='sm'>
                    {data.status}
                  </Badge>
                  <Badge variant={feedbackBadgeVariant(priorityColor(data.priority))} size='sm'>
                    {data.priority}
                  </Badge>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--vhyx-color-border)', margin: 0, width: '100%' }} />

              {/* ── Core fields ── */}
              <Field label='Description' value={data.description} />
              <Field label='Steps to reproduce' value={data.stepsToReproduce} />
              <Field label='Expected behavior' value={data.expectedBehavior} />
              <Field label='Actual behavior' value={data.actualBehavior} />

              {/* ── Admin notes — shown when filled ── */}
              {data.adminNotes && (
                <Alert variant='info' icon={<i className='tabler-notes' />}>
                  <Typography variant='caption' style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Admin note
                  </Typography>
                  {data.adminNotes}
                </Alert>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid var(--vhyx-color-border)', margin: 0, width: '100%' }} />

              {/* ── Meta ── */}
              <div className='flex flex-col gap-2'>
                {data.pageUrl && (
                  <div className='flex justify-between gap-4'>
                    <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                      Page
                    </Typography>
                    <Typography
                      variant='caption'
                      style={{
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'right'
                      }}
                    >
                      {data.pageUrl}
                    </Typography>
                  </div>
                )}
                {data.appVersion && (
                  <div className='flex justify-between'>
                    <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                      App version
                    </Typography>
                    <Typography variant='caption'>{data.appVersion}</Typography>
                  </div>
                )}
                <div className='flex justify-between'>
                  <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                    Submitted
                  </Typography>
                  <Typography variant='caption'>{new Date(data.createdAt).toLocaleString()}</Typography>
                </div>
                {data.resolvedAt && (
                  <div className='flex justify-between'>
                    <Typography variant='caption' style={{ color: 'var(--vhyx-color-text-subtle)' }}>
                      Resolved
                    </Typography>
                    <Typography variant='caption' style={{ color: 'var(--vhyx-color-success)' }}>
                      {new Date(data.resolvedAt).toLocaleString()}
                    </Typography>
                  </div>
                )}
              </div>

              {/* ── Attachments ── */}
              {data.attachments?.length > 0 && (
                <div>
                  <Typography
                    variant='caption'
                    style={{
                      color: 'var(--vhyx-color-text-subtle)',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      display: 'block'
                    }}
                  >
                    Attachments
                  </Typography>
                  <div className='flex flex-col gap-1' style={{ marginTop: 6 }}>
                    {data.attachments.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='flex items-center gap-1 hover:underline'
                        style={{ textDecoration: 'none', color: 'var(--vhyx-color-accent)', fontSize: 'var(--vhyx-text-sm)' }}
                      >
                        <i className='tabler-paperclip text-sm' />
                        Attachment {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}
