'use client'

import { BarChart3, Github, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '../ui/button.tsx'
import { ThemeToggle } from '../ui/theme-toggle.tsx'
import { ClaudeIcon } from './ClaudeIcon.tsx'

export function Header() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <nav aria-label="Main navigation">
          <div className="flex gap-4" style={{ alignItems: 'last baseline' }}>
            <button
              aria-label="Home"
              className="hidden font-medium text-foreground text-lg transition-colors hover:text-primary md:block"
              onClick={() => router.push('/')}
              type="button"
            >
              awesome-claude-plugins
            </button>

            <button
              aria-label="Search repositories"
              className={`flex items-center gap-2 text-sm ${pathname === '/' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              onClick={() => router.push('/')}
              type="button"
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              <span>Search</span>
            </button>

            <button
              aria-label="View statistics"
              className={`flex items-center gap-2 text-sm ${pathname === '/stats' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              onClick={() => router.push('/stats')}
              type="button"
            >
              <BarChart3 aria-hidden="true" className="h-4 w-4" />
              <span>Stats</span>
            </button>
          </div>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="outline">
            <a
              aria-label="Claude Code documentation"
              href="https://code.claude.com/docs/en/plugins"
              rel="noopener noreferrer"
              target="_blank"
            >
              <ClaudeIcon />
            </a>
          </Button>
          <Button asChild size="icon" variant="outline">
            <a
              aria-label="GitHub repository"
              href="https://github.com/quemsah/awesome-claude-plugins"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Github />
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
