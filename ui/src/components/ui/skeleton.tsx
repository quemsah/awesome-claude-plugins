import type * as React from 'react'

import { cn } from '../../lib/utils.ts'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export { Skeleton }
