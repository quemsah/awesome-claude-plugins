import type * as React from 'react'

import { cn } from '../../lib/utils.ts'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('rounded-md bg-muted motion-safe:animate-pulse', className)} {...props} />
}

export { Skeleton }
