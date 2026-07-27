import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const calloutVariants = cva(
  "mb-4 rounded-lg border bg-card px-4 py-3 text-sm [&>a]:underline [&>a]:underline-offset-4 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  {
    variants: {
      variant: {
        default:
          "border-muted-foreground/20 bg-muted/50 text-foreground",
        info: "border-sky-600 bg-sky-100 text-sky-900 dark:border-sky-400 dark:bg-sky-900/60 dark:text-sky-100",
        success:
          "border-emerald-600 bg-emerald-100 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-900/60 dark:text-emerald-100",
        warning:
          "border-amber-600 bg-amber-100 text-amber-900 dark:border-amber-400 dark:bg-amber-900/60 dark:text-amber-100",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Callout({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Callout, calloutVariants }
