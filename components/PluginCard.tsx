import { Plugin } from '../app/types.ts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.tsx'
import { Badge } from './ui/badge.tsx'
import { StarIcon, ForkIcon } from './Icons.tsx'

interface PluginCardProps {
  plugin: Plugin
}

export function PluginCard({ plugin }: PluginCardProps) {
  if (!plugin.repo_name) return null

  return (
    <Card className="h-full transition-all hover:shadow-lg hover:scale-105 cursor-pointer group">
      <CardHeader>
        <CardTitle className="text-lg group-hover:text-primary transition-colors">{plugin.repo_name}</CardTitle>
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
          <Badge variant="secondary">Plugin</Badge>
        </div>
        <div className="mt-4">
          <a href={`/${plugin.repo_name.toLowerCase()}`} className="text-primary hover:underline">
            View Details
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
