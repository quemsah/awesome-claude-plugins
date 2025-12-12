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
      <CardHeader className="p-0 mb-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage alt={repo.owner.login} src={repo.owner.avatar_url} />
              <AvatarFallback>{repo.owner.login.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-bold mb-2 break-words">{repo.name}</h1>
              <CardDescription className="text-lg break-words">
                by{' '}
                <a
                  aria-label={`View ${repo.owner.login}'s GitHub profile`}
                  className="hover:text-primary hover:underline underline-offset-4"
                  href={repo.owner.html_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {repo.owner.login}
                </a>
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 sm:flex-nowrap sm:ml-4">
            {!!repo.homepage && (
              <Button aria-label="Repository homepage" asChild className="flex-1  sm:w-auto justify-center" variant="outline">
                <a aria-label="Visit repository homepage" href={repo.homepage} rel="noopener noreferrer" target="_blank">
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  Homepage
                </a>
              </Button>
            )}
            <Button aria-label="View on GitHub" asChild className="flex-1  sm:w-auto justify-center">
              <a aria-label="View repository on GitHub" href={repo.html_url} rel="noopener noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {!!repo.description && <p className="text-lg mb-6 text-muted-foreground">{repo.description}</p>}

        <div className="flex flex-wrap gap-4 mb-6">
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
          <div className="flex flex-wrap gap-2 mb-6">
            {repo.topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!!repo.language && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Code className="h-4 w-4" />
                Language
              </dt>
              <dd className="text-foreground">{repo.language}</dd>
            </div>
          )}
          {!!repo.license && (
            <div>
              <dt className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                License
              </dt>
              <dd className="text-foreground">{repo.license.name}</dd>
            </div>
          )}
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Size</dt>
            <dd className="text-foreground">{formatSize(repo.size)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Created</dt>
            <dd className="text-foreground">{formatDate(repo.created_at)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Last Updated</dt>
            <dd className="text-foreground">{formatDate(repo.updated_at)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-muted-foreground">Last Pushed</dt>
            <dd className="text-foreground">{formatDate(repo.pushed_at)}</dd>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
