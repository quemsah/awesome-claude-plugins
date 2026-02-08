'use client'

import { BarChart3, Github, Info, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '../ui/button.tsx'
import { ClaudeIcon } from './ClaudeIcon.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <nav aria-label="Main navigation">
          <div className="flex gap-4" style={{ alignItems: 'last baseline' }}>
            <Link
              aria-label="Home"
              className="hidden font-medium text-foreground text-lg transition-colors hover:text-primary md:block"
              href="/"
            >
              awesome-claude-plugins
            </Link>

            <Link
              aria-label="Search repositories"
              className={`flex items-center gap-2 text-sm ${pathname === '/' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/"
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              <span>Search</span>
            </Link>

            <Link
              aria-label="View statistics"
              className={`flex items-center gap-2 text-sm ${pathname === '/stats' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/stats"
            >
              <BarChart3 aria-hidden="true" className="h-4 w-4" />
              <span>Stats</span>
            </Link>
            <Link
              aria-label="About project"
              className={`flex items-center gap-2 text-sm ${pathname === '/about' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/about"
            >
              <Info aria-hidden="true" className="h-4 w-4" />
              <span>About</span>
            </Link>
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
