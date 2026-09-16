// import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

// const Collapsible = CollapsiblePrimitive.Root

// const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

// const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

// export { Collapsible, CollapsibleTrigger, CollapsibleContent }

import React from 'react'
import { Box, Collapse, Button } from '@mui/material'
import { ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material'

const CollapsibleContext = React.createContext()

const Collapsible = React.forwardRef(({ children, open, onOpenChange, defaultOpen = false, ...props }, ref) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen

  const handleToggle = () => {
    const newValue = !isOpen
    if (!isControlled) {
      setInternalOpen(newValue)
    }
    if (onOpenChange) {
      onOpenChange(newValue)
    }
  }

  return (
    <CollapsibleContext.Provider value={{ isOpen, handleToggle }}>
      <Box ref={ref} {...props}>
        {children}
      </Box>
    </CollapsibleContext.Provider>
  )
})
Collapsible.displayName = 'Collapsible'

const useCollapsible = () => {
  const context = React.useContext(CollapsibleContext)
  if (!context) {
    throw new Error('Collapsible components must be wrapped in <Collapsible>')
  }
  return context
}

const CollapsibleTrigger = React.forwardRef(({ children, asChild = false, ...props }, ref) => {
  const { isOpen, handleToggle } = useCollapsible()

  if (asChild) {
    return React.cloneElement(React.Children.only(children), {
      ref,
      onClick: handleToggle,
      'aria-expanded': isOpen,
      ...props
    })
  }

  return (
    <Button
      ref={ref}
      onClick={handleToggle}
      aria-expanded={isOpen}
      startIcon={isOpen ? <ExpandMoreIcon /> : <ChevronRightIcon />}
      {...props}
    >
      {children}
    </Button>
  )
})
CollapsibleTrigger.displayName = 'CollapsibleTrigger'

const CollapsibleContent = React.forwardRef(({ children, ...props }, ref) => {
  const { isOpen } = useCollapsible()

  return (
    <Collapse in={isOpen}>
      <Box ref={ref} {...props}>
        {children}
      </Box>
    </Collapse>
  )
})
CollapsibleContent.displayName = 'CollapsibleContent'

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
// import React from 'react'
// import { Box, Collapse, IconButton, styled } from '@mui/material'
// import { ChevronDown as ChevronDownIcon, ChevronUp as ChevronUpIcon } from '@mui/icons-material'

// const Collapsible = React.forwardRef(({ children, defaultOpen = false, ...props }, ref) => {
//   const [open, setOpen] = React.useState(defaultOpen)

//   return (
//     <Box ref={ref} {...props}>
//       {React.Children.map(children, child => {
//         if (child.type.displayName === 'CollapsibleTrigger') {
//           return React.cloneElement(child, {
//             open,
//             onClick: () => setOpen(!open)
//           })
//         }
//         if (child.type.displayName === 'CollapsibleContent') {
//           return React.cloneElement(child, { open })
//         }
//         return child
//       })}
//     </Box>
//   )
// })
// Collapsible.displayName = 'Collapsible'

// const CollapsibleTrigger = React.forwardRef(({ children, open, onClick, ...props }, ref) => {
//   return (
//     <IconButton ref={ref} onClick={onClick} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} {...props}>
//       {children}
//       {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
//     </IconButton>
//   )
// })
// CollapsibleTrigger.displayName = 'CollapsibleTrigger'

// const CollapsibleContent = React.forwardRef(({ children, open, ...props }, ref) => {
//   return (
//     <Collapse in={open}>
//       <Box ref={ref} {...props}>
//         {children}
//       </Box>
//     </Collapse>
//   )
// })
// CollapsibleContent.displayName = 'CollapsibleContent'

// export { Collapsible, CollapsibleTrigger, CollapsibleContent }
