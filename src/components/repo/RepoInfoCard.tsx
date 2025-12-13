import type { components } from '@octokit/openapi-types'
import { CircleDot, Code, ExternalLink, Eye, FileText, GitFork, Star } from 'lucide-react'
import { formatDate as formatDateUtil } from '../../lib/utils.ts'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader } from '../ui/card.tsx'

type Repository = components['schemas']['repository']

interface RepoInfoCardProps {
  repo: Repository
}

export function RepoInfoCard({ repo }: RepoInfoCardProps) {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Unknown'
    return formatDateUtil(new Date(dateString))
  }

  const formatSize = (size: number | null) => {
    if (size === null || size === undefined) return 'Unknown'
    const kb = size
    if (kb < 1024) return `${kb} KB`
    const mb = kb / 1024
    return `${mb.toFixed(1)} MB`
  }

  return (
    <Card className="p-8">
      <CardHeader className="mb-0 p-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage alt={repo.owner.login} src={repo.owner.avatar_url} />
              <AvatarFallback>{repo.owner.login.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="mb-2 break-words font-bold text-3xl">{repo.name}</h1>
              <CardDescription className="break-words text-lg">
                by{' '}
                <a
                  aria-label={`View ${repo.owner.login}'s GitHub profile`}
                  className="underline-offset-4 hover:text-primary hover:underline"
                  href={repo.owner.html_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {repo.owner.login}
                </a>
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 sm:ml-4 sm:flex-nowrap">
            {!!repo.homepage && (
              <Button aria-label="Repository homepage" asChild className="flex-1 justify-center sm:w-auto" variant="outline">
                <a aria-label="Visit repository homepage" href={repo.homepage} rel="noopener noreferrer" target="_blank">
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  Homepage
                </a>
              </Button>
            )}
            <Button aria-label="View on GitHub" asChild className="flex-1 justify-center sm:w-auto">
              <a aria-label="View repository on GitHub" href={repo.html_url} rel="noopener noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {!!repo.description && <p className="mb-6 text-lg text-muted-foreground">{repo.description}</p>}

        <div className="mb-6 flex flex-wrap gap-4">
          <Badge className="gap-2 text-sm" variant="secondary">
            <Star className="h-5 w-5" />
            <span className="font-semibold">{repo.stargazers_count?.toLocaleString() ?? 0}</span>
            <span>stars</span>
          </Badge>
          <Badge className="gap-2 text-sm" variant="secondary">
            <GitFork className="h-5 w-5" />
            <span className="font-semibold">{repo.forks_count?.toLocaleString() ?? 0}</span>
            <span>forks</span>
          </Badge>
          <Badge className="gap-2 text-sm" variant="secondary">
            <Eye className="h-5 w-5" />
            <span className="font-semibold">{repo.watchers_count?.toLocaleString() ?? 0}</span>
            <span>watchers</span>
          </Badge>
          <Badge className="gap-2 text-sm" variant="secondary">
            <CircleDot className="h-5 w-5" />
            <span className="font-semibold">{repo.open_issues_count?.toLocaleString() ?? 0}</span>
            <span>issues</span>
          </Badge>
        </div>

        {!!repo.topics && repo.topics.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {repo.topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        )}

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!!repo.language && (
            <div>
              <dt className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
                <Code className="h-4 w-4" />
                Language
              </dt>
              <dd className="text-foreground">{repo.language}</dd>
            </div>
          )}
          {!!repo.license && (
            <div>
              <dt className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
                <FileText className="h-4 w-4" />
                License
              </dt>
              <dd className="text-foreground">{repo.license.name}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium text-muted-foreground text-sm">Size</dt>
            <dd className="text-foreground">{formatSize(repo.size)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground text-sm">Created</dt>
            <dd className="text-foreground">{formatDate(repo.created_at)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground text-sm">Last Updated</dt>
            <dd className="text-foreground">{formatDate(repo.updated_at)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground text-sm">Last Pushed</dt>
            <dd className="text-foreground">{formatDate(repo.pushed_at)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
