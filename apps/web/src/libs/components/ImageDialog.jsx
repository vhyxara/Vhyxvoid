'use client'

import { useState } from 'react'
import DialogCloseButton from '@/components/dialogs/DialogCloseButton'
import { Dialog, DialogTitle, DialogContent } from '@mui/material'
import Image from 'next/image'

const ImageDialog = ({ open, setOpen, src, title = 'Image', alt = 'Image' }) => {
  let imgSrc = src || '/images/icons/default-image.jpg'
  const handleClose = () => {
    setOpen(false)
  }

  return (
    <Dialog
      fullWidth
      maxWidth='xs'
      scroll='body'
      open={open}
      onClose={handleClose}
      aria-labelledby='add-banner-dialog-title'
      sx={{ '& .MuiDialog-paper': { overflow: 'visible', padding: '10px' } }}
    >
      <DialogCloseButton onClick={handleClose} disableRipple>
        <i className='tabler-x' />
      </DialogCloseButton>
      <DialogTitle className='text-center'>{title}</DialogTitle>
      <DialogContent className='flex justify-center items-center p-0'>
        <Image height={200} width={200} className=' h-auto rounded' src={imgSrc} alt={alt} />
      </DialogContent>
    </Dialog>
  )
}

export default ImageDialog
