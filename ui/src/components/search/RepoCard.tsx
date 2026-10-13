'use client'

import { GitFork, Star } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isArchivedRepo } from '../../lib/catalog.ts'
import { copyText } from '../../lib/clipboard.ts'
import { getMarketplaceAddCommand } from '../../lib/installCommand.ts'
import { getGitHubOwnerUrl, getGitHubRepoPath } from '../../lib/repositoryIdentity.ts'
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

function getFreshnessText(pushedAt?: string | null, createdAt?: string | null): string | null {
  if (pushedAt) {
    const relativeTime = formatRelativeTime(pushedAt)
    return relativeTime ? `updated ${relativeTime}` : null
  }
  if (createdAt) {
    const relativeTime = formatRelativeTime(createdAt)
    return relativeTime ? `added ${relativeTime}` : null
  }
  return null
}

function ArchivedBadge() {
  return (
    <Badge
      className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 font-semibold text-[10px] text-amber-600 uppercase tracking-wider dark:text-amber-400"
      variant="outline"
    >
      Archived
    </Badge>
  )
}

function RepoFreshnessAndLicense({ freshnessText, license }: { freshnessText: string | null; license?: string | null }) {
  if (!(freshnessText || license)) return null

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
      {freshnessText ? <span suppressHydrationWarning>{freshnessText}</span> : null}
      {freshnessText && license ? <span aria-hidden="true">·</span> : null}
      {license ? (
        <Badge className="px-1.5 py-0 font-normal text-[11px]" variant="outline">
          {license}
        </Badge>
      ) : null}
    </div>
  )
}

function RepoMetrics({
  stargazersCount,
  forksCount,
  pluginsCount,
}: {
  stargazersCount?: number | null
  forksCount?: number | null
  pluginsCount?: number | null
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Star aria-hidden="true" className="h-4 w-4" />
        <span className="text-xs">{formatNumber(stargazersCount ?? 0)}</span>
        <span className="sr-only">stars</span>
      </div>
      <div className="flex items-center gap-1">
        <GitFork aria-hidden="true" className="h-4 w-4" />
        <span className="text-xs">{formatNumber(forksCount ?? 0)}</span>
        <span className="sr-only">forks</span>
      </div>
      {pluginsCount !== null && pluginsCount !== undefined && (
        <div className="flex items-center gap-1">
          <ClaudeIcon aria-hidden="true" />
          <span className="text-xs">{formatNumber(pluginsCount)}</span>
          <span className="sr-only">plugins</span>
        </div>
      )}
    </div>
  )
}

interface MarketplaceCommandBarProps {
  command: string
  isCopied: boolean
  onCopy: () => void
}

function MarketplaceCommandBar({ command, isCopied, onCopy }: MarketplaceCommandBarProps) {
  const label = isCopied ? 'Marketplace command copied' : 'Copy marketplace command'
  return (
    <div className="mt-3 border-border border-t">
      <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-xs">
        <code className="grow truncate font-mono" title={command}>
          {command}
        </code>
        <button
          aria-label={label}
          className={`touch-target shrink-0 rounded-md p-2 transition-colors ${isCopied ? 'bg-status-positive/20 text-status-positive' : 'hover:bg-muted'}`}
          onClick={onCopy}
          title={label}
          type="button"
        >
          {isCopied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  )
}

interface RepoCardProps {
  repo: Repo
  className?: string
}

export function RepoCard({ repo, className }: RepoCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isMounted = useRef(true)
  const marketplaceCommand = useMemo(() => getMarketplaceAddCommand(repo.owner, repo.repo_name), [repo.owner, repo.repo_name])

  const isArchived = isArchivedRepo(repo)
  const freshnessText = getFreshnessText(repo.pushed_at, repo.created_at)

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
      // Restart rather than stack: a second copy while the first countdown runs would otherwise be
      // cut short by the older timer, dropping the confirmation before its two seconds are up.
      clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setIsCopied(false), 2_000)
    } else {
      setCopyError('Unable to copy the marketplace command. Select and copy it manually.')
    }
  }, [marketplaceCommand])

  const detailsPath = `/${getGitHubRepoPath(repo.owner ?? '', repo.repo_name ?? '')}`

  return (
    <Card
      className={`group relative h-full transition-all duration-300 hover:border-primary/30 hover:bg-linear-to-tl hover:from-muted hover:to-background ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CardHeader className="-space-y-2 pr-14 sm:pr-16">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base transition-colors duration-300 group-hover:text-primary sm:text-lg">
            <h2>{repo.repo_name}</h2>
          </CardTitle>
          {isArchived ? <ArchivedBadge /> : null}
        </div>
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
          <p className="mb-3 line-clamp-2 text-muted-foreground text-sm">{repo.description?.trim() || 'No description available.'}</p>
        </div>
        <RepoFreshnessAndLicense freshnessText={freshnessText} license={repo.license} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <RepoMetrics forksCount={repo.forks_count} pluginsCount={repo.plugins_count} stargazersCount={repo.stargazers_count} />
          <Button asChild className="h-9 w-full sm:h-8 sm:w-auto">
            <Link aria-label={`View details for ${repo.owner ?? ''}/${repo.repo_name ?? ''}`} href={detailsPath} prefetch={false}>
              Details
            </Link>
          </Button>
        </div>
        {marketplaceCommand ? <MarketplaceCommandBar command={marketplaceCommand} isCopied={isCopied} onCopy={handleCopyClick} /> : null}
      </CardContent>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {copyError ?? (isCopied ? 'Marketplace command copied' : '')}
      </span>
    </Card>
  )
}
