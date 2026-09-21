import { cn } from '../../lib/utils.ts'
import { Card, CardContent, CardHeader } from '../ui/card.tsx'

function Bar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} />
}

/**
 * Mirrors RepoCard element for element so a placeholder claims the box its real card will take. The
 * bars copy measured line boxes, not font sizes: `text-base` / `sm:text-lg` carry their own
 * line-height (24px / 28px) and win over CardTitle's `leading-none`. Where a bar fills its whole
 * line box it would touch the bar below it, so `bg-clip-content` paints it shorter than it measures.
 */
export function RepoCardSkeleton() {
  return (
    <Card aria-hidden="true" className="relative h-full">
      <CardHeader className="-space-y-2 pr-14 sm:pr-16">
        <Bar className="h-6 w-2/5 bg-clip-content pb-1 sm:h-7 sm:pb-2" />
        <Bar className="absolute top-4 right-4 h-8 w-8 rounded-md border sm:top-6 sm:right-6" />
        <Bar className="h-5 w-1/4 bg-clip-content pb-1" />
      </CardHeader>
      <CardContent className="flex h-full flex-col">
        <div className="grow">
          <div className="mb-4">
            <Bar className="h-5 w-full bg-clip-content pb-1" />
            <Bar className="h-5 w-3/5 bg-clip-content pb-1" />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Bar className="h-4 w-4 rounded-full" />
              <Bar className="h-4 w-7" />
            </div>
            <div className="flex items-center gap-1">
              <Bar className="h-4 w-4 rounded-full" />
              <Bar className="h-4 w-6" />
            </div>
            <div className="flex items-center gap-1">
              <Bar className="h-4 w-4 rounded-full" />
              <Bar className="h-4 w-5" />
            </div>
          </div>
          <Bar className="h-9 w-full sm:h-8 sm:w-20" />
        </div>
        <div className="mt-3 border-border border-t">
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
            <Bar className="h-4 grow" />
            <Bar className="h-8 w-8 shrink-0" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
