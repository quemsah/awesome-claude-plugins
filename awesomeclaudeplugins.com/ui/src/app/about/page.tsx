import { CheckCircle2, Globe, Puzzle, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { AboutStructuredData } from '../../components/about/AboutStructuredData.tsx'
import { Breadcrumbs } from '../../components/common/Breadcrumbs.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getAboutBreadcrumbs } from '../../lib/breadcrumbs.ts'

export default function AboutPage() {
  return (
    <main className="bg-background min-h-dvh" id="main-content" tabIndex={-1}>
      <AboutStructuredData />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Breadcrumbs items={getAboutBreadcrumbs()} />
        <div className="mb-6 space-y-4 text-center">
          <h1 className="text-foreground text-4xl font-bold text-balance md:text-5xl">About This Project</h1>
          <p className="text-muted-foreground mx-auto max-w-2xl text-lg text-pretty">
            A daily-updated directory of Claude Code plugins and tools, inspired by the "awesome" list movement. Just trying to keep up with
            the ecosystem.
          </p>
        </div>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
              <ShieldCheck className="text-primary h-5 w-5" />
              <h2>How to read the directory</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-4 sm:grid-cols-2">
            <p className="flex gap-2">
              <CheckCircle2 className="text-primary mt-1 h-4 w-4 shrink-0" />
              Repositories are discovered from public GitHub data and refreshed daily.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="text-primary mt-1 h-4 w-4 shrink-0" />
              Plugin counts reflect marketplace manifests we can validate, not endorsements.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="text-primary mt-1 h-4 w-4 shrink-0" />
              Stars, forks, and metadata come from GitHub and may change over time.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="text-primary mt-1 h-4 w-4 shrink-0" />
              Review code, licenses, and maintenance before installing.
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <Puzzle className="text-primary h-5 w-5" />
                <h2>Automated discovery</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>
                This isn't just a static list. Plugin data is collected from GitHub when the crawler runs, helping new Claude Code
                repositories appear in the directory.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <Globe className="text-primary h-5 w-5" />
                <h2>Why?</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>
                Finding good plugins was getting annoying, so I automated the search. The goal is just to have one reliable place to look
                when you need a specific tool or integration for your Claude.
              </p>
            </CardContent>
          </Card>
        </div>
        <p className="text-muted-foreground mt-6 text-center text-sm">
          For details on analytics, browser storage, and performance measurement, see our{' '}
          <Link className="hover:text-foreground underline-offset-4 hover:underline" href="/privacy">
            Privacy page
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
