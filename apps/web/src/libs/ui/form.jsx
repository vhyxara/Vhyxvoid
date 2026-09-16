// import * as React from "react"
// import { Slot } from "@radix-ui/react-slot"
// import {
//   Controller,
//   FormProvider,
//   useFormContext,
// } from "react-hook-form"

// import { cn } from "@/lib/utils"
// import { Label } from "@/components/ui/label"

// const Form = FormProvider

// const FormFieldContext = React.createContext({})

// const FormField = ({
//   ...props
// }) => {
//   return (
//     <FormFieldContext.Provider value={{ name: props.name }}>
//       <Controller {...props} />
//     </FormFieldContext.Provider>
//   )
// }

// const useFormField = () => {
//   const fieldContext = React.useContext(FormFieldContext)
//   const itemContext = React.useContext(FormItemContext)
//   const { getFieldState, formState } = useFormContext()

//   const fieldState = getFieldState(fieldContext.name, formState)

//   if (!fieldContext) {
//     throw new Error("useFormField should be used within <FormField>")
//   }

//   const { id } = itemContext

//   return {
//     id,
//     name: fieldContext.name,
//     formItemId: `${id}-form-item`,
//     formDescriptionId: `${id}-form-item-description`,
//     formMessageId: `${id}-form-item-message`,
//     ...fieldState,
//   }
// }

// const FormItemContext = React.createContext({})

// const FormItem = React.forwardRef(({ className, ...props }, ref) => {
//   const id = React.useId()

//   return (
//     <FormItemContext.Provider value={{ id }}>
//       <div ref={ref} className={cn("space-y-2", className)} {...props} />
//     </FormItemContext.Provider>
//   )
// })
// FormItem.displayName = "FormItem"

// const FormLabel = React.forwardRef(({ className, ...props }, ref) => {
//   const { error, formItemId } = useFormField()

//   return (
//     <Label
//       ref={ref}
//       className={cn(error && "text-destructive", className)}
//       htmlFor={formItemId}
//       {...props}
//     />
//   )
// })
// FormLabel.displayName = "FormLabel"

// const FormControl = React.forwardRef(({ ...props }, ref) => {
//   const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

//   return (
//     <Slot
//       ref={ref}
//       id={formItemId}
//       aria-describedby={
//         !error
//           ? `${formDescriptionId}`
//           : `${formDescriptionId} ${formMessageId}`
//       }
//       aria-invalid={!!error}
//       {...props}
//     />
//   )
// })
// FormControl.displayName = "FormControl"

// const FormDescription = React.forwardRef(({ className, ...props }, ref) => {
//   const { formDescriptionId } = useFormField()

//   return (
//     <p
//       ref={ref}
//       id={formDescriptionId}
//       className={cn("text-sm text-muted-foreground", className)}
//       {...props}
//     />
//   )
// })
// FormDescription.displayName = "FormDescription"

// const FormMessage = React.forwardRef(({ className, children, ...props }, ref) => {
//   const { error, formMessageId } = useFormField()
//   const body = error ? String(error?.message) : children

//   if (!body) {
//     return null
//   }

//   return (
//     <p
//       ref={ref}
//       id={formMessageId}
//       className={cn("text-sm font-medium text-destructive", className)}
//       {...props}
//     >
//       {body}
//     </p>
//   )
// })
// FormMessage.displayName = "FormMessage"

// export {
//   useFormField,
//   Form,
//   FormItem,
//   FormLabel,
//   FormControl,
//   FormDescription,
//   FormMessage,
//   FormField,
// }
import React from 'react'
import classNames from 'classnames'
import { Controller, FormProvider, useFormContext } from 'react-hook-form'
import {
  FormControl as MuiFormControl,
  FormHelperText,
  FormLabel as MuiFormLabel,
  Typography,
  Box
} from '@mui/material'

const Form = FormProvider

const FormFieldContext = React.createContext({})

const FormField = props => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>')
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState
  }
}

const FormItemContext = React.createContext({})

const FormItem = React.forwardRef(({ className, ...props }, ref) => {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <Box
        ref={ref}
        className={classNames('space-y-2', className)}
        sx={{ '& > * + *': { marginTop: '8px' } }}
        {...props}
      />
    </FormItemContext.Provider>
  )
})
FormItem.displayName = 'FormItem'

const FormLabel = React.forwardRef(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()

  return (
    <MuiFormLabel
      ref={ref}
      className={classNames(error && 'text-error', className)}
      htmlFor={formItemId}
      error={!!error}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

const FormControl = React.forwardRef(({ asChild, ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <MuiFormControl
      ref={ref}
      id={formItemId}
      error={!!error}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      {...props}
    />
  )
})
FormControl.displayName = 'FormControl'

const FormDescription = React.forwardRef(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()

  return (
    <Typography
      ref={ref}
      id={formDescriptionId}
      variant='body2'
      className={classNames('text-muted-foreground', className)}
      color='text.secondary'
      {...props}
    />
  )
})
FormDescription.displayName = 'FormDescription'

const FormMessage = React.forwardRef(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message) : children

  if (!body) {
    return null
  }

  return (
    <FormHelperText
      ref={ref}
      id={formMessageId}
      error={!!error}
      className={classNames('font-medium', className)}
      {...props}
    >
      {body}
    </FormHelperText>
  )
})
FormMessage.displayName = 'FormMessage'

export { useFormField, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField }
