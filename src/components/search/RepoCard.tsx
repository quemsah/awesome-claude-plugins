import { GitFork, Star } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Repo } from '../../schemas/repo.schema.ts'
import { ClaudeIcon } from '../common/ClaudeIcon.tsx'
import { CopiedIcon } from '../common/CopiedIcon.tsx'
import { CopyIcon } from '../common/CopyIcon.tsx'
import { Button } from '../ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'
import { AnimatedGithubIcon } from './AnimatedGithubIcon.tsx'

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(num)
}

interface RepoCardProps {
  repo: Repo
  className?: string
}

export function RepoCard({ repo, className }: RepoCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const hasValidRepoInfo = Boolean(repo.owner && repo.repo_name)

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const getMarketplaceCommand = useCallback(() => `/plugin marketplace add ${repo.owner}/${repo.repo_name}`, [repo.owner, repo.repo_name])

  const handleCopyClick = useCallback(() => {
    if (repo.owner && repo.repo_name) {
      navigator.clipboard.writeText(getMarketplaceCommand())
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 500)
    }
  }, [repo.owner, repo.repo_name, getMarketplaceCommand])

  if (!repo.repo_name) return null

  return (
    <Card
      className={`group relative h-full transition-all duration-300 hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CardHeader className="-space-y-2 pr-14">
        <CardTitle className="text-lg transition-colors duration-300 group-hover:text-primary">
          <h3>{repo.repo_name}</h3>
        </CardTitle>
        <CardDescription className="text-muted-foreground text-sm">
          by{' '}
          <a className="underline-offset-4 hover:text-primary hover:underline" href={`https://github.com/${repo.owner}`}>
            {repo.owner}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex h-full flex-col">
        <div className="grow">
          {!!repo.description && <p className="mb-4 line-clamp-2 text-muted-foreground text-sm">{repo.description}</p>}
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
          <Button asChild className="h-8 shrink-0">
            <a aria-label={`View details for ${repo.owner}/${repo.repo_name}`} href={`/${repo.owner}/${repo.repo_name}`}>
              Details
            </a>
          </Button>
        </div>
        {hasValidRepoInfo ? (
          <div className="mt-3 border-muted/20 border-t">
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
              <code className="grow break-all font-mono">{getMarketplaceCommand()}</code>
              <button
                aria-label={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
                className={`shrink-0 rounded-md p-1 transition-colors ${isCopied ? 'bg-green-500/20 text-green-600' : 'hover:bg-muted'}`}
                onClick={handleCopyClick}
                title={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
                type="button"
              >
                {isCopied ? <CopiedIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
      <Button asChild className="absolute top-6 right-6 h-8 w-8" size="icon" variant="outline">
        <a aria-label="View repository on GitHub" href={repo.html_url} rel="noopener noreferrer" target="_blank">
          <AnimatedGithubIcon isHovered={isHovered} />
        </a>
      </Button>
    </Card>
  )
}
