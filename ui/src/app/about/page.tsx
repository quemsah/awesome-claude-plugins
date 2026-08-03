import { CheckCircle2, Globe, Puzzle, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { AboutStructuredData } from '../../components/about/AboutStructuredData.tsx'
import { Breadcrumbs } from '../../components/common/Breadcrumbs.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getAboutBreadcrumbs } from '../../lib/breadcrumbs.ts'
import { SOURCE_REPOSITORY_URL } from '../../lib/constants.ts'

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <AboutStructuredData />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Breadcrumbs items={getAboutBreadcrumbs()} />
        <div className="mb-6 space-y-4 text-center">
          <h1 className="text-balance font-bold text-4xl text-foreground md:text-5xl">About This Project</h1>
          <p className="mx-auto max-w-2xl text-pretty text-lg text-muted-foreground">
            A daily-updated directory of Claude Code plugins and tools, inspired by the "awesome" list movement. Just trying to keep up with
            the ecosystem.
          </p>
        </div>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2>How to read the directory</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-muted-foreground sm:grid-cols-2">
            <p className="flex gap-2">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
              Repositories are discovered from public GitHub data and refreshed daily.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
              Plugin counts reflect marketplace manifests we can validate, not endorsements.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
              Stars, forks, and metadata come from GitHub and may change over time.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
              Review code, licenses, and maintenance before installing.
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5 text-primary" />
                <h2>Automated Discovery</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>
                This isn't just a static list. I've set up <strong>n8n workflows</strong> that scan GitHub every day for new Claude Code
                repositories. If it's out there to use with Claude, it should hopefully show up here automatically.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
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
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Corrections, provenance, and limitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-muted-foreground">
            <p>
              The checked-in catalog is generated from public GitHub data and refreshed daily. Repository detail pages request current
              public GitHub metadata when available and show a labeled catalog snapshot during temporary outages.
            </p>
            <p>
              This directory does not certify security, quality, licensing, maintenance, or compatibility. Popularity metrics are
              descriptive signals only; evaluate the source repository before installing anything.
            </p>
            <p>
              To report a missing, duplicated, or inaccurate entry, open an issue in the{' '}
              <a
                className="underline-offset-4 hover:text-foreground hover:underline"
                href={`${SOURCE_REPOSITORY_URL}/issues`}
                rel="noopener noreferrer"
                target="_blank"
              >
                public source repository
              </a>
              .
            </p>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-muted-foreground text-sm">
          For details on analytics, browser storage, and performance measurement, see our{' '}
          <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/privacy">
            Privacy page
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
