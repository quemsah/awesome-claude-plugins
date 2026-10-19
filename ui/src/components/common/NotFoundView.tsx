'use client'

import { ExternalLink, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getGitHubRepoUrl, isGitHubSegment } from '../../lib/repositoryIdentity.ts'
import { Button } from '../ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'

interface NotFoundViewProps {
  isRepo?: boolean
}

interface MissingRepository {
  owner: string
  repoName: string
}

function getMissingRepository(pathname: string): MissingRepository | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || ['stats', 'about', 'privacy'].includes(segments[0])) return null
  if (!segments.every(isGitHubSegment)) return null

  return { owner: segments[0], repoName: segments[1] }
}

function NotFoundHeading({ isRepository }: { isRepository: boolean }) {
  return (
    <CardHeader className="text-center">
      <CardTitle className="font-bold text-4xl text-muted-foreground">
        <h1>404</h1>
      </CardTitle>
      <CardDescription className="text-lg">{isRepository ? 'Repository not found' : 'Page not found'}</CardDescription>
    </CardHeader>
  )
}

function RepositoryNotFoundLinks({ owner, repoName }: MissingRepository) {
  return (
    <>
      <Button asChild className="w-full sm:w-auto">
        <Link href={`/?q=${encodeURIComponent(repoName)}`}>
          <Search className="mr-2 h-4 w-4" />
          Search for "{repoName}"
        </Link>
      </Button>
      <Button asChild className="w-full sm:w-auto" variant="outline">
        <a href={getGitHubRepoUrl(owner, repoName)} rel="noopener noreferrer" target="_blank">
          <ExternalLink className="mr-2 h-4 w-4" />
          Check on GitHub
        </a>
      </Button>
    </>
  )
}

function NotFoundContent({ repository }: { repository: MissingRepository | null }) {
  return (
    <CardContent className="space-y-4 text-center">
      <p className="text-muted-foreground">
        {repository
          ? "We couldn't find this repository in our catalog. It may have been removed, renamed, or not indexed yet."
          : "Sorry, we couldn't find the page you're looking for."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {repository ? (
          <RepositoryNotFoundLinks {...repository} />
        ) : (
          <Button aria-label="Go to home page" asChild className="w-auto">
            <Link href="/">Go home</Link>
          </Button>
        )}
      </div>
      {repository ? (
        <div className="pt-2">
          <Link className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground" href="/">
            Browse catalog home
          </Link>
        </div>
      ) : null}
    </CardContent>
  )
}

export function NotFoundView({ isRepo }: NotFoundViewProps) {
  const pathname = usePathname() || ''
  const repository = isRepo === false ? null : getMissingRepository(pathname)

  return (
    <main className="flex min-h-dvh items-center justify-center p-4" id="main-content" tabIndex={-1}>
      <Card className="w-full max-w-md">
        <NotFoundHeading isRepository={repository !== null} />
        <NotFoundContent repository={repository} />
      </Card>
    </main>
  )
}
