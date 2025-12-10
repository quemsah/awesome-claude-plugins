import { Card, CardContent, CardHeader } from './ui/card.tsx'
import { Skeleton } from './ui/skeleton.tsx'

export function LoadingContent() {
  const skeletonKeys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {skeletonKeys.map((key) => (
        <Card className="h-full" key={`loading-${key}`}>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3 mb-4" />
            <div className="flex justify-between items-center">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
