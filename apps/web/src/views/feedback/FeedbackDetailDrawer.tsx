'use client'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Alert from '@mui/material/Alert'

import { useFeedbackDetail } from '@/api/application/hooks/useFeedback'
import { typeLabel, typeColor, statusColor, priorityColor } from '@/utils/feedback.util'

// import type { FeedbackStatus, FeedbackPriority } from '@/api/domain/feedback/feedback.types'
// import type { FeedbackType } from '@/hooks/useFeedbackDialog'

// ── Color maps ────────────────────────────────────────────────────────────

// function typeColor(type: FeedbackType) {
//   const map = {
//     BUG_REPORT: 'error',
//     UI_ISSUE: 'info',
//     FEATURE_REQUEST: 'warning',
//     GENERAL_FEEDBACK: 'success'
//   } as const

//   return map[type] ?? 'default'
// }

// function statusColor(status: FeedbackStatus) {
//   const map = {
//     OPEN: 'warning',
//     UNDER_REVIEW: 'info',
//     IN_PROGRESS: 'primary',
//     RESOLVED: 'success',
//     CLOSED: 'default',
//     WONT_FIX: 'error'
//   } as const

//   return map[status] ?? 'default'
// }

// function priorityColor(priority: FeedbackPriority) {
//   const map = {
//     LOW: 'default',
//     MEDIUM: 'warning',
//     HIGH: 'error',
//     CRITICAL: 'error'
//   } as const

//   return map[priority] ?? 'default'
// }

// function typeLabel(type: FeedbackType) {
//   return type
//     .replace(/_/g, ' ')
//     .toLowerCase()
//     .replace(/^\w/, c => c.toUpperCase())
// }

// ── Field row ─────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null

  return (
    <Box>
      <Typography
        variant='caption'
        color='text.secondary'
        fontWeight={500}
        textTransform='uppercase'
        letterSpacing={0.5}
      >
        {label}
      </Typography>
      <Typography variant='body2' sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
        {value}
      </Typography>
    </Box>
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
    <Drawer
      anchor='right'
      open={!!feedbackId}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, p: 0 } }}
    >
      {/* ── Header ── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          bgcolor: 'background.paper',
          zIndex: 1
        }}
      >
        <Typography variant='subtitle1' fontWeight={600}>
          Feedback detail
        </Typography>
        <IconButton size='small' onClick={onClose}>
          <i className='tabler-x' />
        </IconButton>
      </Box>

      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Skeleton variant='rounded' height={28} width='60%' />
            <Skeleton variant='rounded' height={20} width='40%' />
            <Skeleton variant='rounded' height={80} />
            <Skeleton variant='rounded' height={60} />
          </Box>
        ) : !data ? null : (
          <>
            {/* ── Title + badges ── */}
            <Box>
              <Typography variant='h6' fontWeight={600} gutterBottom>
                {data.title}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={typeLabel(data.type)} color={typeColor(data.type)} size='small' />
                <Chip label={data.status} color={statusColor(data.status)} size='small' variant='tonal' />
                <Chip label={data.priority} color={priorityColor(data.priority)} size='small' variant='outlined' />
              </Box>
            </Box>

            <Divider />

            {/* ── Core fields ── */}
            <Field label='Description' value={data.description} />
            <Field label='Steps to reproduce' value={data.stepsToReproduce} />
            <Field label='Expected behavior' value={data.expectedBehavior} />
            <Field label='Actual behavior' value={data.actualBehavior} />

            {/* ── Admin notes — shown when filled ── */}
            {data.adminNotes && (
              <Alert severity='info' icon={<i className='tabler-notes' />}>
                <Typography variant='caption' fontWeight={600} display='block' gutterBottom>
                  Admin note
                </Typography>
                {data.adminNotes}
              </Alert>
            )}

            <Divider />

            {/* ── Meta ── */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {data.pageUrl && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant='caption' color='text.secondary'>
                    Page
                  </Typography>
                  <Typography
                    variant='caption'
                    sx={{
                      maxWidth: 260,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      textAlign: 'right'
                    }}
                  >
                    {data.pageUrl}
                  </Typography>
                </Box>
              )}
              {data.appVersion && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant='caption' color='text.secondary'>
                    App version
                  </Typography>
                  <Typography variant='caption'>{data.appVersion}</Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant='caption' color='text.secondary'>
                  Submitted
                </Typography>
                <Typography variant='caption'>{new Date(data.createdAt).toLocaleString()}</Typography>
              </Box>
              {data.resolvedAt && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant='caption' color='text.secondary'>
                    Resolved
                  </Typography>
                  <Typography variant='caption' color='success.main'>
                    {new Date(data.resolvedAt).toLocaleString()}
                  </Typography>
                </Box>
              )}
            </Box>

            {/* ── Attachments ── */}
            {data.attachments?.length > 0 && (
              <Box>
                <Typography
                  variant='caption'
                  color='text.secondary'
                  fontWeight={500}
                  textTransform='uppercase'
                  letterSpacing={0.5}
                >
                  Attachments
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 0.75 }}>
                  {data.attachments.map((url, i) => (
                    <Typography
                      key={i}
                      component='a'
                      href={url}
                      target='_blank'
                      rel='noopener noreferrer'
                      variant='body2'
                      color='primary'
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' }
                      }}
                    >
                      <i className='tabler-paperclip text-sm' />
                      Attachment {i + 1}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Drawer>
  )
}
