import { Card, CardContent, CardHeader } from '../ui/card.tsx'
import { Skeleton } from '../ui/skeleton.tsx'

export function LoadingContent() {
  const skeletonKeys = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {skeletonKeys.map((key) => (
        <Card aria-hidden="true" className="h-full transition-opacity duration-300" key={key}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
            <div className="flex items-center justify-between pt-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-12 rounded-md" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
