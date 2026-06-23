import type { Repo } from '../../schemas/repo.schema.ts'
import { Card, CardContent } from '../ui/card.tsx'
import { InfiniteRepoGrid } from './InfiniteRepoGrid.tsx'

interface LoadedContentProps {
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  repos: Repo[]
}

export function LoadedContent({ hasMore, isLoadingMore, onLoadMore, repos }: LoadedContentProps) {
  return repos.length === 0 ? (
    <Card className="py-12 text-center">
      <CardContent>
        <p className="text-muted-foreground">No repositories found</p>
      </CardContent>
    </Card>
  ) : (
    <InfiniteRepoGrid hasMore={hasMore} isLoadingMore={isLoadingMore} items={repos} onLoadMore={onLoadMore} />
  )
}
