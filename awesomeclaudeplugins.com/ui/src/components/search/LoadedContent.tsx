import type { PendingCatalogLoad } from '../../lib/searchState.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { Card, CardContent } from '../ui/card.tsx'
import { InfiniteRepoGrid } from './InfiniteRepoGrid.tsx'

interface LoadedContentProps {
  hasMore: boolean
  onLoadMore: () => void
  pendingLoad: PendingCatalogLoad
  replaceCompletion: number
  repos: Repo[]
}

export function LoadedContent({ hasMore, onLoadMore, pendingLoad, replaceCompletion, repos }: LoadedContentProps) {
  return repos.length === 0 ? (
    <Card className="py-12 text-center">
      <CardContent>
        <p className="text-muted-foreground">No repositories found</p>
      </CardContent>
    </Card>
  ) : (
    <InfiniteRepoGrid
      hasMore={hasMore}
      items={repos}
      onLoadMore={onLoadMore}
      pendingLoad={pendingLoad}
      replaceCompletion={replaceCompletion}
    />
  )
}
