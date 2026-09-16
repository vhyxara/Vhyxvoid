// import * as React from "react"
// import { cva, type VariantProps } from "class-variance-authority"

// import { cn } from "@/lib/utils"

// const badgeVariants = cva(
//   "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
//   {
//     variants: {
//       variant: {
//         default:
//           "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
//         secondary:
//           "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
//         destructive:
//           "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
//         outline: "text-foreground",
//       },
//     },
//     defaultVariants: {
//       variant: "default",
//     },
//   }
// )

// export interface BadgeProps
//   extends React.HTMLAttributes<HTMLDivElement>,
//     VariantProps<typeof badgeVariants> {}

// function Badge({ className, variant, ...props }: BadgeProps) {
//   return (
//     <div className={cn(badgeVariants({ variant }), className)} {...props} />
//   )
// }

// export { Badge, badgeVariants }
import React from 'react'
import classNames from 'classnames'

export function Badge({ className = '', variant = 'default', children, ...props }) {
  const baseClasses =
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2'

  const variantClasses = {
    default: 'border-transparent bg-blue-600 text-white hover:bg-blue-500',
    secondary: 'border-transparent bg-gray-200 text-gray-800 hover:bg-gray-300',
    destructive: 'border-transparent bg-red-600 text-white hover:bg-red-700',
    outline: 'border border-gray-400 text-gray-800'
  }

  const badgeClass = classNames(baseClasses, variantClasses[variant], className)

  return (
    <div className={badgeClass} {...props}>
      {children}
    </div>
  )
}
