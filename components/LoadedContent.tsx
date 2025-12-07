import type { Plugin } from '../app/types/plugin.type.ts'
import { PluginCard } from './PluginCard.tsx'
import { Card, CardContent } from './ui/card.tsx'

interface LoadedContentProps {
  plugins: Plugin[]
}

export function LoadedContent({ plugins }: LoadedContentProps) {
  return plugins.length === 0 ? (
    <Card className="text-center py-12">
      <CardContent>
        <p className="text-muted-foreground">No plugins found</p>
      </CardContent>
    </Card>
  ) : (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {plugins.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} />
      ))}
    </div>
  )
}
