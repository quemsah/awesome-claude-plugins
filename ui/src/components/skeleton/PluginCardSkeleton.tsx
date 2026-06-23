import { Card, CardContent, CardHeader } from '../ui/card.tsx'
import { Skeleton } from '../ui/skeleton.tsx'

interface PluginCardSkeletonProps {
  count?: number
}

export function PluginCardSkeleton({ count = 1 }: PluginCardSkeletonProps) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <Card aria-hidden="true" className="w-full" key={index}>
          <CardHeader className="-space-y-2 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
            </div>
          </CardHeader>
          <div className="px-6 pb-4">
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
          <CardContent className="space-y-2 pt-1">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-32" />
            <div className="flex flex-wrap gap-1 pt-1">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-md" />
              <Skeleton className="h-5 w-14 rounded-md" />
            </div>
            <div className="space-y-2 pt-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
            <div className="space-y-2 pt-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
