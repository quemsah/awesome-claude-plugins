'use client'

import { GitFork, Star } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { copyText } from '../../lib/clipboard.ts'
import { getMarketplaceAddCommand } from '../../lib/installCommand.ts'
import { getGitHubOwnerUrl, getGitHubRepoPath } from '../../lib/repositoryIdentity.ts'
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
  const [copyError, setCopyError] = useState<string | null>(null)
  const marketplaceCommand = useMemo(() => getMarketplaceAddCommand(repo.owner, repo.repo_name), [repo.owner, repo.repo_name])
  const hasValidRepoInfo = Boolean(marketplaceCommand)

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const handleCopyClick = useCallback(async () => {
    if (!marketplaceCommand) return

    const copied = await copyText(marketplaceCommand)
    if (copied) {
      setCopyError(null)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2_000)
    } else {
      setCopyError('Unable to copy the marketplace command. Select and copy it manually.')
    }
  }, [marketplaceCommand])

  return (
    <Card
      className={`group relative h-full transition-all duration-300 hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CardHeader className="-space-y-2 pr-14 sm:pr-16">
        <CardTitle className="text-base transition-colors duration-300 group-hover:text-primary sm:text-lg">
          <h2>{repo.repo_name}</h2>
        </CardTitle>
        <Button asChild className="touch-target absolute top-4 right-4 h-8 w-8 sm:top-6 sm:right-6" size="icon" variant="outline">
          <a aria-label={`View ${repo.owner}/${repo.repo_name} on GitHub`} href={repo.html_url} rel="noopener noreferrer" target="_blank">
            <AnimatedGithubIcon isHovered={isHovered} />
          </a>
        </Button>
        <CardDescription className="text-muted-foreground text-sm">
          by{' '}
          <a
            className="underline-offset-4 hover:text-primary hover:underline"
            href={getGitHubOwnerUrl(repo.owner ?? '')}
            rel="noopener noreferrer"
            target="_blank"
          >
            {repo.owner ?? ''}
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex h-full flex-col">
        <div className="grow">
          <p className="mb-4 line-clamp-2 text-muted-foreground text-sm">{repo.description?.trim() || 'No description available.'}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Star aria-hidden="true" className="h-4 w-4" />
              <span className="text-xs">{formatNumber(repo.stargazers_count ?? 0)}</span>
              <span className="sr-only">stars</span>
            </div>
            <div className="flex items-center gap-1">
              <GitFork aria-hidden="true" className="h-4 w-4" />
              <span className="text-xs">{formatNumber(repo.forks_count ?? 0)}</span>
              <span className="sr-only">forks</span>
            </div>
            {repo.plugins_count !== null && (
              <div className="flex items-center gap-1">
                <ClaudeIcon aria-hidden="true" />
                <span className="text-xs">{formatNumber(repo.plugins_count ?? 0)}</span>
                <span className="sr-only">plugins</span>
                {(repo.stargazers_count ?? 0) < 10 && <span className="text-muted-foreground text-xs">(low signal)</span>}
              </div>
            )}
          </div>
          <Button asChild className="h-9 w-full sm:h-8 sm:w-auto">
            <Link
              aria-label={`View details for ${repo.owner ?? ''}/${repo.repo_name ?? ''}`}
              href={`/${getGitHubRepoPath(repo.owner ?? '', repo.repo_name ?? '')}`}
              prefetch={false}
            >
              Details
            </Link>
          </Button>
        </div>
        {hasValidRepoInfo ? (
          <div className="mt-3 border-border border-t">
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
              <code className="grow truncate font-mono" title={marketplaceCommand ?? undefined}>
                {marketplaceCommand}
              </code>
              <button
                aria-label={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
                className={`touch-target shrink-0 rounded-md p-2 transition-colors ${isCopied ? 'bg-status-positive/20 text-status-positive' : 'hover:bg-muted'}`}
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
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {copyError ?? (isCopied ? 'Marketplace command copied' : '')}
      </span>
    </Card>
  )
}
