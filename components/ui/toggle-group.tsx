import * as React from "react"

import { cn } from "@/lib/utils"

const ToggleGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn("flex flex-wrap gap-2", className)}
      {...props}
    />
  )
)

ToggleGroup.displayName = "ToggleGroup"

type ToggleGroupItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pressed?: boolean
}

const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ className, pressed = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/70 disabled:cursor-not-allowed disabled:opacity-50",
        pressed
          ? "border-primary bg-primary/10 text-primary shadow-sm"
          : "border-input bg-transparent text-muted-foreground hover:border-primary hover:text-primary",
        className
      )}
      {...props}
    />
  )
)

ToggleGroupItem.displayName = "ToggleGroupItem"

export { ToggleGroup, ToggleGroupItem }
