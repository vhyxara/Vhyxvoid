'use client'
import { useState } from 'react'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import LoadingButton from '@mui/lab/LoadingButton'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'

import { useTransferOwnership } from '@/api/application/hooks/useMembers'
import { getMemberEmail, getMemberInitials, getMemberName, type Member } from '@/api/domain/identity/types/member.types'

type Props = {
  open: boolean
  onClose: () => void
  row: Member
  accountId: string
}

export function TransferOwnershipDialog({ open, onClose, row, accountId }: Props) {
  const transfer = useTransferOwnership(accountId)
  const [confirmed, setConfirmed] = useState(false)

  const handleClose = () => {
    setConfirmed(false)
    onClose()
  }

  const handleConfirm = () => {
    transfer.mutate({ targetUserId: row.userId }, { onSuccess: handleClose })
  }

  const initials = getMemberInitials(row)

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='xs' fullWidth>
      <DialogTitle>Transfer ownership</DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: '16px !important' }}>
        <Alert severity='warning'>This action is permanent and cannot be undone.</Alert>

        {/* Target member identity */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 36, height: 36, bgcolor: 'warning.main', fontSize: 13 }}>{initials}</Avatar>
          <Box>
            <Typography variant='body2' fontWeight={500}>
              {getMemberName(row)}
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              {getMemberEmail(row)}
            </Typography>
          </Box>
        </Box>

        <Typography variant='body2' color='text.secondary'>
          Transferring ownership will:
        </Typography>

        <Box component='ul' sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography component='li' variant='body2' color='text.secondary'>
            Make{' '}
            <Typography component='span' fontWeight={500} color='text.primary'>
              {getMemberName(row)}
            </Typography>{' '}
            the new Owner
          </Typography>
          <Typography component='li' variant='body2' color='text.secondary'>
            Demote you to Admin
          </Typography>
          <Typography component='li' variant='body2' color='text.secondary'>
            Take effect immediately across all sessions
          </Typography>
        </Box>

        {/* Explicit confirmation checkbox — prevents accidental clicks */}
        <FormControlLabel
          control={<Checkbox checked={confirmed} onChange={e => setConfirmed(e.target.checked)} color='warning' />}
          label={<Typography variant='body2'>I understand this cannot be undone</Typography>}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose} variant='outlined' color='secondary'>
          Cancel
        </Button>
        <LoadingButton
          onClick={handleConfirm}
          loading={transfer.isPending}
          disabled={!confirmed}
          variant='contained'
          color='error'
        >
          Transfer ownership
        </LoadingButton>
      </DialogActions>
    </Dialog>
  )
}
