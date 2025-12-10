import { ExternalLink, GitFork, Star } from 'lucide-react'
import type { Repo } from '../app/types/repo.type.ts'
import { PluginIcon } from './PluginIcon.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.tsx'

interface RepoCardProps {
  repo: Repo
  className?: string
}

export function RepoCard({ repo, className }: RepoCardProps) {
  if (!repo.repo_name) return null

  return (
    <Card
      className={`h-full cursor-pointer group hover:border-primary/30 hover:bg-gradient-to-tl hover:from-muted hover:to-background transition-all duration-300 ${className}`}
    >
      <CardHeader>
        <CardTitle className="text-lg group-hover:text-primary transition-colors duration-300">{repo.repo_name}</CardTitle>
        <CardDescription>by {repo.owner}</CardDescription>
      </CardHeader>
      <CardContent>
        {!!repo.description && (
          <p className="text-sm text-muted-foreground opacity-90 group-hover:opacity-100 transition-opacity duration-300 mb-4 line-clamp-2">
            {repo.description}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4" />
              <span className="text-sm">{repo.stargazers_count?.toLocaleString() ?? 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <GitFork className="h-4 w-4" />
              <span className="text-sm">{repo.forks_count?.toLocaleString() ?? 0}</span>
            </div>
            {repo.plugins_count !== null && (
              <div className="flex items-center gap-1">
                <PluginIcon />
                <span className="text-sm">{repo.plugins_count?.toLocaleString() ?? 0}</span>
              </div>
            )}
          </div>
          <a
            className="text-sm px-3 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors flex items-center gap-1"
            href={`/${repo.owner}/${repo.repo_name}`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
