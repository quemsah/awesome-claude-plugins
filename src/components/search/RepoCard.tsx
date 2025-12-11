import { GitFork, Star } from 'lucide-react'
import { useState } from 'react'
import type { Repo } from '../../app/types/repo.type.ts'
import { ClaudeIcon } from '../common/ClaudeIcon.tsx'
import { Button } from '../ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'
import { AnimatedGithubIcon } from './AnimatedGithubIcon.tsx'

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

interface RepoCardProps {
  repo: Repo
  className?: string
}

export function RepoCard({ repo, className }: RepoCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  if (!repo.repo_name) return null

  return (
    <Card
      className={`h-full group hover:border-primary/30 hover:bg-gradient-to-tl hover:from-muted hover:to-background transition-all duration-300 relative ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardHeader className="pr-14 -space-y-2">
        <CardTitle className="text-lg group-hover:text-primary transition-colors duration-300">{repo.repo_name}</CardTitle>
        <CardDescription className="text-muted-foreground text-sm">
          by{' '}
          <a className="hover:text-primary hover:underline underline-offset-4" href={`https://github.com/${repo.owner}`}>
            {repo.owner}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col h-full">
        <div className="flex-grow">
          {!!repo.description && (
            <p className="text-sm text-muted-foreground opacity-90 group-hover:opacity-100 transition-opacity duration-300 mb-4 line-clamp-2">
              {repo.description}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4" />
              <span className="text-xs">{formatNumber(repo.stargazers_count ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1">
              <GitFork className="h-4 w-4" />
              <span className="text-xs">{formatNumber(repo.forks_count ?? 0)}</span>
            </div>
            {repo.plugins_count !== null && (
              <div className="flex items-center gap-1">
                <ClaudeIcon />
                <span className="text-xs">{formatNumber(repo.plugins_count ?? 0)}</span>
              </div>
            )}
          </div>
          <Button asChild className="h-8 flex-shrink-0">
            <a href={`/${repo.owner}/${repo.repo_name}`}>Details</a>
          </Button>
        </div>
      </CardContent>
      <Button asChild className="absolute top-6 right-6 h-8 w-8" size="icon" variant="outline">
        <a href={repo.html_url} rel="noopener noreferrer" target="_blank">
          <AnimatedGithubIcon isHovered={isHovered} />
        </a>
      </Button>
    </Card>
  )
}
