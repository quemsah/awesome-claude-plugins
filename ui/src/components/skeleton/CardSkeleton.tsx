import { Card, CardContent } from '../ui/card.tsx'
import { Skeleton } from '../ui/skeleton.tsx'

interface CardSkeletonProps {
  count?: number
}

export function CardSkeleton({ count = 1 }: CardSkeletonProps) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, index) => (
        <Card className="w-full p-0" key={index}>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
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
