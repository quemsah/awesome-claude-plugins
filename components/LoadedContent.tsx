import type { Repo } from '../app/types/repo.type.ts'
import { InfiniteRepoGrid } from './InfiniteRepoGrid.tsx'
import type { SortOption } from './Sort.tsx'
import { Card, CardContent } from './ui/card.tsx'

interface LoadedContentProps {
  repos: Repo[]
  sortOption?: SortOption
}

export function LoadedContent({ repos, sortOption }: LoadedContentProps) {
  return repos.length === 0 ? (
    <Card className="text-center py-12">
      <CardContent>
        <p className="text-muted-foreground">No repositories found</p>
      </CardContent>
    </Card>
  ) : (
    <InfiniteRepoGrid items={repos} sortOption={sortOption} />
  )
}
