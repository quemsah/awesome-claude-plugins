import { Globe, Puzzle } from 'lucide-react'
import { Header } from '../../components/common/Header.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 space-y-4 text-center">
          <h1 className="bg-linear-to-r from-foreground to-foreground/70 bg-clip-text font-bold text-4xl text-transparent md:text-5xl">
            About This Project
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            A daily-updated directory of Claude Code plugins and tools, inspired by the "awesome" list movement. Just trying to keep up with
            the ecosystem.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5 text-primary" />
                Automated Discovery
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
                Why?
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
      </div>
    </main>
  )
}
