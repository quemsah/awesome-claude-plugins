'use client'

import { ExternalLink, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getGitHubRepoUrl, isGitHubSegment } from '../../lib/repositoryIdentity.ts'
import { Button } from '../ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx'

interface NotFoundViewProps {
  isRepo?: boolean
  owner?: string
  repoName?: string
}

export function NotFoundView(props: NotFoundViewProps) {
  const pathname = usePathname() || ''
  const segments = pathname.split('/').filter(Boolean)

  const detectedIsRepo =
    segments.length === 2 && !['stats', 'about', 'privacy'].includes(segments[0]) && segments.every(isGitHubSegment)
  const isRepo = detectedIsRepo && (props.isRepo ?? true)

  const owner = props.owner ?? (isRepo && segments.length >= 2 ? segments[0] : '')
  const repoName = props.repoName ?? (isRepo && segments.length >= 2 ? segments[1] : '')
  const repoPath = owner && repoName ? `${owner}/${repoName}` : ''

  return (
    <main className="flex min-h-dvh items-center justify-center p-4" id="main-content" tabIndex={-1}>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-bold text-4xl text-muted-foreground">
            <h1>404</h1>
          </CardTitle>
          <CardDescription className="text-lg">{isRepo ? 'Repository not found' : 'Page not found'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">
            {isRepo
              ? "We couldn't find this repository in our catalog. It may have been removed, renamed, or not indexed yet."
              : "Sorry, we couldn't find the page you're looking for."}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            {isRepo && repoName ? (
              <>
                <Button asChild className="w-full sm:w-auto">
                  <Link href={`/?q=${encodeURIComponent(repoName)}`}>
                    <Search className="mr-2 h-4 w-4" />
                    Search for "{repoName}"
                  </Link>
                </Button>
                {repoPath ? (
                  <Button asChild className="w-full sm:w-auto" variant="outline">
                    <a href={getGitHubRepoUrl(owner, repoName)} rel="noopener noreferrer" target="_blank">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Check on GitHub
                    </a>
                  </Button>
                ) : null}
              </>
            ) : (
              <Button aria-label="Go to home page" asChild className="w-auto">
                <Link href="/">Go home</Link>
              </Button>
            )}
          </div>

          {isRepo ? (
            <div className="pt-2">
              <Link className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground" href="/">
                Browse catalog home
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
