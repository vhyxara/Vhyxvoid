'use client'

import { useState, type ElementType, type MouseEvent } from 'react'

type OpenDialogOnElementClickProps<E extends ElementType, D extends ElementType> = {
  element: E
  dialog: D
  elementProps?: any
  dialogProps?: any
}

export default function OpenDialogOnElementClick<E extends ElementType, D extends ElementType>({
  element: Element,
  dialog: Dialog,
  elementProps,
  dialogProps
}: OpenDialogOnElementClickProps<E, D>) {
  const [open, setOpen] = useState(false)

  const handleClick = (e: MouseEvent<any>) => {
    elementProps?.onClick?.(e)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
  }

  return (
    <>
      <Element {...elementProps} onClick={handleClick} />

      <Dialog {...dialogProps} open={open} onClose={handleClose} />
    </>
  )
}
