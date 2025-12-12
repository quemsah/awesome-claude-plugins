import { GitFork, Star } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Repo } from '../../app/types/repo.type.ts'
import { ClaudeIcon } from '../common/ClaudeIcon.tsx'
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
      className={`h-full group hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background transition-all duration-300 relative ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
        {hasValidRepoInfo ? (
          <div className="mt-3 border-t border-muted/20">
            <div className="bg-muted/50 rounded-md p-2 text-xs flex items-center gap-2">
              <code className="font-mono break-all flex-grow">{getMarketplaceCommand()}</code>
              <button
                aria-label={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
                className={`p-1 rounded-md transition-colors flex-shrink-0 ${isCopied ? 'bg-green-500/20 text-green-600' : 'hover:bg-muted'}`}
                onClick={handleCopyClick}
                title={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
                type="button"
              >
                {isCopied ? (
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="16"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="16"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>Copied</title>
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="16"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="16"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>Copy</title>
                    <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
      <Button asChild className="absolute top-6 right-6 h-8 w-8" size="icon" variant="outline">
        <a href={repo.html_url} rel="noopener noreferrer" target="_blank">
          <AnimatedGithubIcon isHovered={isHovered} />
        </a>
      </Button>
    </Card>
  )
}
