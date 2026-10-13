import { CheckCircle2, Globe, Puzzle, Scale, ShieldCheck, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { AboutStructuredData } from '../../components/about/AboutStructuredData.tsx'
import { Breadcrumbs } from '../../components/common/Breadcrumbs.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { getAboutBreadcrumbs } from '../../lib/breadcrumbs.ts'

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-background" id="main-content" tabIndex={-1}>
      <AboutStructuredData />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Breadcrumbs items={getAboutBreadcrumbs()} />
        <div className="mb-8 space-y-4 text-center">
          <h1 className="text-balance font-bold text-4xl text-foreground md:text-5xl">About This Project</h1>
          <p className="mx-auto max-w-2xl text-pretty text-lg text-muted-foreground">
            A daily-updated directory indexing the entire Claude Code plugin ecosystem across GitHub. Compare our directory with
            Anthropic&apos;s official catalogs and discover when to use each.
          </p>
        </div>

        {/* Catalog Comparison Table */}
        <Card className="mt-8 overflow-hidden">
          <CardHeader className="border-b bg-muted/30 pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Scale className="h-5 w-5 text-primary" />
              <h2>Comparison: Official Anthropic Catalogs vs. Awesome Claude Plugins</h2>
            </CardTitle>
            <CardDescription>How Anthropic&apos;s curated repositories differ from this automated, ecosystem-wide index.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Comparison between official Anthropic plugin catalogs and Awesome Claude Plugins</caption>
                <thead>
                  <tr className="border-b bg-muted/40 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 sm:px-6" scope="col">
                      Catalog
                    </th>
                    <th className="px-4 py-3 sm:px-6" scope="col">
                      Size & Scope
                    </th>
                    <th className="px-4 py-3 sm:px-6" scope="col">
                      Verification & Trust
                    </th>
                    <th className="px-4 py-3 sm:px-6" scope="col">
                      Discovery & Features
                    </th>
                    <th className="px-4 py-3 sm:px-6" scope="col">
                      Best For
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="transition-colors hover:bg-muted/20">
                    <td className="px-4 py-4 align-top sm:px-6">
                      <div className="font-semibold text-foreground">
                        <Link
                          className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                          href="/anthropics/claude-plugins-official"
                        >
                          Official Anthropic Catalog
                        </Link>
                      </div>
                      <div className="mt-0.5 font-mono text-muted-foreground text-xs">anthropics/claude-plugins-official</div>
                      <Badge className="mt-2 text-[10px]" variant="secondary">
                        Anthropic Verified
                      </Badge>
                    </td>
                    <td className="px-4 py-4 align-top font-medium text-foreground sm:px-6">~314 plugins</td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      <span className="font-medium text-foreground">Highest curation & security.</span> Manually reviewed and verified
                      directly by Anthropic.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      Official marketplace manifests, vetted first-party toolchain, standard installation commands.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      Production safety, enterprise compliance, zero-risk environments.
                    </td>
                  </tr>

                  <tr className="transition-colors hover:bg-muted/20">
                    <td className="px-4 py-4 align-top sm:px-6">
                      <div className="font-semibold text-foreground">
                        <Link
                          className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                          href="/anthropics/claude-plugins-community"
                        >
                          Anthropic Community Catalog
                        </Link>
                      </div>
                      <div className="mt-0.5 font-mono text-muted-foreground text-xs">anthropics/claude-plugins-community</div>
                      <Badge className="mt-2 text-[10px]" variant="secondary">
                        Community Reviewed
                      </Badge>
                    </td>
                    <td className="px-4 py-4 align-top font-medium text-foreground sm:px-6">~2,282 plugins</td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      <span className="font-medium text-foreground">Reviewed submissions.</span> Submitted by community authors, reviewed
                      under Anthropic guidelines.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      Read-only community mirror, standardized marketplace manifests, broad tooling coverage.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      General community tools, reliable extensions with baseline Anthropic compliance.
                    </td>
                  </tr>

                  <tr className="bg-primary/5 transition-colors hover:bg-primary/10">
                    <td className="px-4 py-4 align-top sm:px-6">
                      <div className="font-semibold text-foreground">
                        <Link className="inline-flex items-center gap-1 hover:text-primary hover:underline" href="/">
                          Awesome Claude Plugins
                        </Link>
                      </div>
                      <div className="mt-0.5 text-muted-foreground text-xs">This Directory</div>
                      <Badge className="mt-2 text-[10px]" variant="default">
                        Full GitHub Ecosystem
                      </Badge>
                    </td>
                    <td className="px-4 py-4 align-top font-medium text-foreground sm:px-6">
                      40,000+ repos
                      <div className="font-normal text-muted-foreground text-xs">(110,000+ plugins)</div>
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      <span className="font-medium text-foreground">Unvetted open source.</span> Automated daily crawl indexing public
                      repositories across GitHub.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      Daily automated crawl, instant full-text & fuzzy search, GitHub stars/forks/activity metrics, historical snapshots,
                      one-click install commands.
                    </td>
                    <td className="px-4 py-4 align-top text-muted-foreground sm:px-6">
                      Finding niche or unsubmitted tools, exploring bleeding-edge repositories, analyzing ecosystem trends.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* When to Choose Which Catalog */}
        <div className="mt-8 space-y-4">
          <div className="text-center">
            <h2 className="font-bold text-2xl text-foreground">When Should You Use Each Catalog?</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Both official catalogs and this open-ended directory serve complementary roles in the Claude Code ecosystem.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
                  <h3>Choose Official Anthropic Catalogs when:</h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-muted-foreground text-sm">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Production & Enterprise Safety:</strong> You need strict assurance that plugins have
                    passed Anthropic review guidelines and contain verified manifest definitions.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Verified First-Party Integrations:</strong> You are seeking official Anthropic
                    toolchains, official cloud adapters, or high-trust enterprise integrations.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Minimal Vetting Overhead:</strong> You prefer a smaller, strictly curated catalog
                    without needing to independently audit GitHub code, licenses, or commit history.
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="h-5 w-5 shrink-0 text-primary" />
                  <h3>Choose Awesome Claude Plugins when:</h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-muted-foreground text-sm">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Finding Niche & Specialized Tools:</strong> You need domain-specific skills, local
                    scripts, or specialized prompts that developers never formally submitted to Anthropic&apos;s marketplace.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Bleeding-Edge Exploration:</strong> You want to discover what the open-source
                    community created yesterday across GitHub, before formal review or registry submission.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <strong className="text-foreground">Ecosystem Intelligence & Search:</strong> You want instant full-text search across
                    40,000+ repos, sorted by GitHub stars, forks, or validated plugin count, plus copy-ready install commands.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* How to Read the Directory */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center justify-center gap-2">
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

        {/* Discovery & Why */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <Puzzle className="h-5 w-5 text-primary" />
                <h2>Automated Discovery</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>
                This isn&apos;t just a static list. Plugin data is collected from GitHub when the crawler runs, helping new Claude Code
                repositories appear in the directory automatically without manual submission gatekeeping.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <h2>Why This Project?</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              <p>
                Finding good plugins across thousands of personal and community GitHub repositories was cumbersome, so we automated the
                search. The goal is to provide one fast, comprehensive directory with direct install commands and popularity metrics.
              </p>
            </CardContent>
          </Card>
        </div>

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
