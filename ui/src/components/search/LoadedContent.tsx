import type { Repo } from '../../schemas/repo.schema.ts'
import { Card, CardContent } from '../ui/card.tsx'
import { InfiniteRepoGrid } from './InfiniteRepoGrid.tsx'

interface LoadedContentProps {
  repos: Repo[]
  resetKey: string
}

export function LoadedContent({ repos, resetKey }: LoadedContentProps) {
  return repos.length === 0 ? (
    <Card className="py-12 text-center">
      <CardContent>
        <p className="text-muted-foreground">No repositories found</p>
      </CardContent>
    </Card>
  ) : (
    <InfiniteRepoGrid items={repos} resetKey={resetKey} />
  )
}
