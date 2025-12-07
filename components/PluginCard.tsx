import type { Plugin } from '../app/types/plugin.type.ts'
import { ForkIcon, StarIcon } from './Icons.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.tsx'

interface PluginCardProps {
  plugin: Plugin
}

export function PluginCard({ plugin }: PluginCardProps) {
  if (!plugin.repo_name) return null

  return (
    <Card className="h-full cursor-pointer group">
      <CardHeader>
        <CardTitle className="text-lg">{plugin.repo_name}</CardTitle>
        <CardDescription>by {plugin.owner}</CardDescription>
      </CardHeader>
      <CardContent>
        {plugin.description && <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{plugin.description}</p>}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <StarIcon />
              <span className="text-sm">{plugin.stargazers_count?.toLocaleString() ?? 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <ForkIcon />
              <span className="text-sm">{plugin.forks_count?.toLocaleString() ?? 0}</span>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <a href={`/${plugin.owner}/${plugin.repo_name}`} className="text-primary hover:underline">
            View Details
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
