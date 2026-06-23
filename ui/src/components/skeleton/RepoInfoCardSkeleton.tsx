import { Card, CardContent, CardHeader } from '../ui/card.tsx'
import { Skeleton } from '../ui/skeleton.tsx'

export function RepoInfoCardSkeleton() {
  return (
    <Card aria-hidden="true" className="p-4 sm:p-8">
      <CardHeader className="mb-0 p-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full sm:h-16 sm:w-16" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-8 w-48 max-w-full sm:h-9 sm:w-64" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:ml-4 sm:flex-row sm:flex-nowrap sm:gap-3">
            <Skeleton className="h-10 w-full sm:w-28" />
            <Skeleton className="h-10 w-full sm:w-36" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>

        <div className="mb-6 flex flex-wrap gap-3 sm:gap-4">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="space-y-2" key={index}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
