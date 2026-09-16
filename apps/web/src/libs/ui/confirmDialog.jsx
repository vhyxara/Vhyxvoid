// components/ConfirmDialog.jsx
import React from 'react'
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material'

export default function ConfirmDialog({
  open,
  title = 'Confirm',
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onClose,
  onConfirm,
  confirmColor = 'error'
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant='body1'>{description}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button
          onClick={() => {
            onConfirm()
            onClose()
          }}
          color={confirmColor}
          variant='contained'
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
