'use client'

import { GitFork, Star } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackEvent } from '../../lib/analytics.ts'
import { copyText } from '../../lib/clipboard.ts'
import { getMarketplaceAddCommand } from '../../lib/installCommand.ts'
import { isArchivedRepo } from '../../lib/repoMetadata.ts'
import { getGitHubOwnerUrl, getGitHubRepoPath, getGitHubRepoUrl } from '../../lib/repositoryIdentity.ts'
import { formatRelativeTime } from '../../lib/utils.ts'
import type { Repo } from '../../schemas/repo.schema.ts'
import { ClaudeIcon } from '../common/ClaudeIcon.tsx'
import { CopiedIcon } from '../common/CopiedIcon.tsx'
import { CopyIcon } from '../common/CopyIcon.tsx'
import { Badge } from '../ui/badge.tsx'
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

function RepoCardHeading({ repo, isHovered }: { repo: Repo; isHovered: boolean }) {
  const archived = isArchivedRepo(repo)
  return (
    <CardHeader className="-space-y-2 pr-14 sm:pr-16">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle className="group-hover:text-primary text-base transition-colors duration-300 sm:text-lg">
          <h2>{repo.repo_name}</h2>
        </CardTitle>
        {archived ? <Badge variant="outline">Archived</Badge> : null}
      </div>
      <Button asChild className="touch-target absolute top-4 right-4 h-8 w-8 sm:top-6 sm:right-6" size="icon" variant="outline">
        <a
          aria-label={`View ${repo.owner}/${repo.repo_name} on GitHub`}
          href={getGitHubRepoUrl(repo.owner ?? '', repo.repo_name ?? '')}
          onClick={() => trackEvent('open_github')}
          rel="noopener noreferrer"
          target="_blank"
        >
          <AnimatedGithubIcon isHovered={isHovered} />
        </a>
      </Button>
      <CardDescription className="text-muted-foreground text-sm">
        by{' '}
        <a
          className="hover:text-primary underline-offset-4 hover:underline"
          href={getGitHubOwnerUrl(repo.owner ?? '')}
          onClick={() => trackEvent('open_github')}
          rel="noopener noreferrer"
          target="_blank"
        >
          {repo.owner ?? ''}
        </a>
      </CardDescription>
    </CardHeader>
  )
}

function RepoCardMetadata({ repo }: { repo: Repo }) {
  const updatedAge = formatRelativeTime(repo.pushed_at)
  const addedAge = formatRelativeTime(repo.catalog_added_at)
  const updatedText = updatedAge ? `updated ${updatedAge}` : null
  const addedText = addedAge ? `added ${addedAge}` : null
  if (!updatedText && !addedText && !repo.license) return null
  return (
    <div className="text-muted-foreground mb-3 flex flex-wrap items-center gap-2 text-xs">
      {updatedText ? <span suppressHydrationWarning>{updatedText}</span> : null}
      {addedText ? <span suppressHydrationWarning>{addedText}</span> : null}
      {repo.license ? <Badge variant="outline">{repo.license}</Badge> : null}
    </div>
  )
}

function RepoCardStats({ repo }: { repo: Repo }) {
  return (
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
        </div>
      )}
    </div>
  )
}

function RepoCardCopyCommand({
  marketplaceCommand,
  isCopied,
  onCopyClick,
}: {
  marketplaceCommand: string | null | undefined
  isCopied: boolean
  onCopyClick: () => void
}) {
  if (!marketplaceCommand) return null
  return (
    <div className="border-border mt-3 border-t">
      <div className="bg-muted/50 flex items-center gap-2 rounded-md p-2 text-xs">
        <code className="grow truncate font-mono" title={marketplaceCommand ?? undefined}>
          {marketplaceCommand}
        </code>
        <button
          aria-label={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
          className={`touch-target shrink-0 rounded-md p-2 transition-colors ${isCopied ? 'bg-status-positive/20 text-status-positive' : 'hover:bg-muted'}`}
          onClick={onCopyClick}
          title={isCopied ? 'Marketplace command copied' : 'Copy marketplace command'}
          type="button"
        >
          {isCopied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  )
}

/** Render a repository preview with GitHub links derived from validated catalog identity. */
export function RepoCard({ repo, className }: RepoCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isMounted = useRef(true)
  const marketplaceCommand = useMemo(() => getMarketplaceAddCommand(repo.owner, repo.repo_name), [repo.owner, repo.repo_name])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      clearTimeout(resetTimer.current)
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const handleCopyClick = useCallback(async () => {
    if (!marketplaceCommand) return

    const copied = await copyText(marketplaceCommand)
    if (!isMounted.current) return

    if (copied) {
      setCopyError(null)
      setIsCopied(true)
      trackEvent('copy_marketplace_add')
      // Restart rather than stack: a second copy while the first countdown runs would otherwise be
      // cut short by the older timer, dropping the confirmation before its two seconds are up.
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setIsCopied(false), 2_000)
    } else {
      setCopyError('Unable to copy the marketplace command. Select and copy it manually.')
    }
  }, [marketplaceCommand])

  return (
    <Card
      className={`group hover:border-primary/30 hover:from-muted hover:to-background relative h-full transition-all duration-300 hover:bg-linear-to-tl ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <RepoCardHeading repo={repo} isHovered={isHovered} />
      <CardContent className="flex h-full flex-col">
        <div className="grow">
          <p className="text-muted-foreground mb-4 line-clamp-2 text-sm">{repo.description?.trim() || 'No description available.'}</p>
        </div>
        <RepoCardMetadata repo={repo} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <RepoCardStats repo={repo} />
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
        <RepoCardCopyCommand marketplaceCommand={marketplaceCommand} isCopied={isCopied} onCopyClick={handleCopyClick} />
      </CardContent>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {copyError ?? (isCopied ? 'Marketplace command copied' : '')}
      </span>
    </Card>
  )
}
