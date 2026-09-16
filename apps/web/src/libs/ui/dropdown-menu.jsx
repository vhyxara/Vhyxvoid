// import * as React from "react"
// import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
// import { Check, ChevronRight, Circle } from "lucide-react"

// import { cn } from "@/lib/utils"

// const DropdownMenu = DropdownMenuPrimitive.Root

// const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

// const DropdownMenuGroup = DropdownMenuPrimitive.Group

// const DropdownMenuPortal = DropdownMenuPrimitive.Portal

// const DropdownMenuSub = DropdownMenuPrimitive.Sub

// const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

// const DropdownMenuSubTrigger = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
//     inset?: boolean
//   }
// >(({ className, inset, children, ...props }, ref) => (
//   <DropdownMenuPrimitive.SubTrigger
//     ref={ref}
//     className={cn(
//       "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
//       inset && "pl-8",
//       className
//     )}
//     {...props}
//   >
//     {children}
//     <ChevronRight className="ml-auto h-4 w-4" />
//   </DropdownMenuPrimitive.SubTrigger>
// ))
// DropdownMenuSubTrigger.displayName =
//   DropdownMenuPrimitive.SubTrigger.displayName

// const DropdownMenuSubContent = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
// >(({ className, ...props }, ref) => (
//   <DropdownMenuPrimitive.SubContent
//     ref={ref}
//     className={cn(
//       "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
//       className
//     )}
//     {...props}
//   />
// ))
// DropdownMenuSubContent.displayName =
//   DropdownMenuPrimitive.SubContent.displayName

// const DropdownMenuContent = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.Content>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
// >(({ className, sideOffset = 4, ...props }, ref) => (
//   <DropdownMenuPrimitive.Portal>
//     <DropdownMenuPrimitive.Content
//       ref={ref}
//       sideOffset={sideOffset}
//       className={cn(
//         "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
//         className
//       )}
//       {...props}
//     />
//   </DropdownMenuPrimitive.Portal>
// ))
// DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

// const DropdownMenuItem = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.Item>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
//     inset?: boolean
//   }
// >(({ className, inset, ...props }, ref) => (
//   <DropdownMenuPrimitive.Item
//     ref={ref}
//     className={cn(
//       "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
//       inset && "pl-8",
//       className
//     )}
//     {...props}
//   />
// ))
// DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

// const DropdownMenuCheckboxItem = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
// >(({ className, children, checked, ...props }, ref) => (
//   <DropdownMenuPrimitive.CheckboxItem
//     ref={ref}
//     className={cn(
//       "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
//       className
//     )}
//     checked={checked}
//     {...props}
//   >
//     <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
//       <DropdownMenuPrimitive.ItemIndicator>
//         <Check className="h-4 w-4" />
//       </DropdownMenuPrimitive.ItemIndicator>
//     </span>
//     {children}
//   </DropdownMenuPrimitive.CheckboxItem>
// ))
// DropdownMenuCheckboxItem.displayName =
//   DropdownMenuPrimitive.CheckboxItem.displayName

// const DropdownMenuRadioItem = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
// >(({ className, children, ...props }, ref) => (
//   <DropdownMenuPrimitive.RadioItem
//     ref={ref}
//     className={cn(
//       "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
//       className
//     )}
//     {...props}
//   >
//     <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
//       <DropdownMenuPrimitive.ItemIndicator>
//         <Circle className="h-2 w-2 fill-current" />
//       </DropdownMenuPrimitive.ItemIndicator>
//     </span>
//     {children}
//   </DropdownMenuPrimitive.RadioItem>
// ))
// DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

// const DropdownMenuLabel = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.Label>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
//     inset?: boolean
//   }
// >(({ className, inset, ...props }, ref) => (
//   <DropdownMenuPrimitive.Label
//     ref={ref}
//     className={cn(
//       "px-2 py-1.5 text-sm font-semibold",
//       inset && "pl-8",
//       className
//     )}
//     {...props}
//   />
// ))
// DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

// const DropdownMenuSeparator = React.forwardRef<
//   React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
//   React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
// >(({ className, ...props }, ref) => (
//   <DropdownMenuPrimitive.Separator
//     ref={ref}
//     className={cn("-mx-1 my-1 h-px bg-muted", className)}
//     {...props}
//   />
// ))
// DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

// const DropdownMenuShortcut = ({
//   className,
//   ...props
// }: React.HTMLAttributes<HTMLSpanElement>) => {
//   return (
//     <span
//       className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
//       {...props}
//     />
//   )
// }
// DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

// export {
//   DropdownMenu,
//   DropdownMenuTrigger,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuCheckboxItem,
//   DropdownMenuRadioItem,
//   DropdownMenuLabel,
//   DropdownMenuSeparator,
//   DropdownMenuShortcut,
//   DropdownMenuGroup,
//   DropdownMenuPortal,
//   DropdownMenuSub,
//   DropdownMenuSubContent,
//   DropdownMenuSubTrigger,
//   DropdownMenuRadioGroup,
// }
import React from 'react'
import { Menu, MenuItem, Checkbox, Radio, ListItemIcon, ListItemText, Divider, Box } from '@mui/material'
import { Check as CheckIcon, ChevronRight as ChevronRightIcon, Circle as CircleIcon } from '@mui/icons-material'

// Main Dropdown Menu Components
// export const DropdownMenu = React.forwardRef((props, ref) => {
//   return <Menu {...props} ref={ref} />
// })

export const DropdownMenu = React.forwardRef(({ open, onOpen, onClose, ...props }, ref) => {
  return (
    <Menu
      ref={ref}
      open={open}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right'
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right'
      }}
      {...props}
    />
  )
})
DropdownMenu.displayName = 'DropdownMenu'

// export const DropdownMenuTrigger = React.forwardRef((props, ref) => {
//   return <Box component='span' {...props} ref={ref} />
// })
export const DropdownMenuTrigger = React.forwardRef(({ children, onClick, ...props }, ref) => {
  return (
    <Box ref={ref} onClick={onClick} {...props}>
      {children}
    </Box>
  )
})
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger'

export const DropdownMenuContent = React.forwardRef(({ className, ...props }, ref) => {
  return <Menu {...props} ref={ref} className={className} />
})

// Menu Items
export const DropdownMenuItem = React.forwardRef(({ inset, className, ...props }, ref) => {
  return <MenuItem ref={ref} className={`${inset ? 'pl-8' : ''} ${className || ''}`} {...props} />
})

export const DropdownMenuCheckboxItem = React.forwardRef(({ children, checked, className, ...props }, ref) => {
  return (
    <MenuItem ref={ref} className={className} {...props}>
      <ListItemIcon>
        <Checkbox
          edge='start'
          checked={checked}
          tabIndex={-1}
          disableRipple
          icon={<span style={{ width: 24 }} />}
          checkedIcon={<CheckIcon style={{ width: 16 }} />}
        />
      </ListItemIcon>
      <ListItemText primary={children} />
    </MenuItem>
  )
})

export const DropdownMenuRadioItem = React.forwardRef(({ children, value, className, ...props }, ref) => {
  return (
    <MenuItem ref={ref} className={className} {...props}>
      <ListItemIcon>
        <Radio
          edge='start'
          value={value}
          tabIndex={-1}
          disableRipple
          icon={<CircleIcon style={{ width: 16, height: 16 }} />}
          checkedIcon={<CircleIcon style={{ width: 16, height: 16 }} />}
        />
      </ListItemIcon>
      <ListItemText primary={children} />
    </MenuItem>
  )
})

// Submenu Components
export const DropdownMenuSub = React.forwardRef((props, ref) => {
  return <Box component='div' {...props} ref={ref} />
})

export const DropdownMenuSubTrigger = React.forwardRef(({ inset, children, className, ...props }, ref) => {
  return (
    <MenuItem ref={ref} className={`${inset ? 'pl-8' : ''} ${className || ''}`} {...props}>
      {children}
      <ChevronRightIcon style={{ marginLeft: 'auto', width: 16, height: 16 }} />
    </MenuItem>
  )
})

export const DropdownMenuSubContent = React.forwardRef(({ className, ...props }, ref) => {
  return <Menu {...props} ref={ref} className={className} />
})

// Grouping Components
export const DropdownMenuGroup = React.forwardRef((props, ref) => {
  return <Box component='div' {...props} ref={ref} />
})

export const DropdownMenuRadioGroup = React.forwardRef((props, ref) => {
  return <Box component='div' {...props} ref={ref} />
})

// Other Components
export const DropdownMenuLabel = React.forwardRef(({ inset, className, ...props }, ref) => {
  return (
    <MenuItem ref={ref} className={`font-semibold ${inset ? 'pl-8' : ''} ${className || ''}`} disabled {...props} />
  )
})

export const DropdownMenuSeparator = React.forwardRef((props, ref) => {
  return <Divider {...props} ref={ref} />
})

export const DropdownMenuShortcut = React.forwardRef(({ className, ...props }, ref) => {
  return <span ref={ref} className={`ml-auto text-xs opacity-60 ${className || ''}`} {...props} />
})

// For compatibility
export const DropdownMenuPortal = React.forwardRef((props, ref) => {
  return <Box component='div' {...props} ref={ref} />
})
