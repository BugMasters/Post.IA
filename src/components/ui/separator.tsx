import * as React from "react"

import { cn } from "@/lib/utils"

function Separator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="presentation"
      className={cn("h-px w-full bg-border/70", className)}
      {...props}
    />
  )
}

export { Separator }
