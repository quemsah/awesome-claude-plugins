'use client'

import { BarChart3, Github, Info, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '../ui/button.tsx'
import { ClaudeIcon } from './ClaudeIcon.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export function Header() {
  const pathname = usePathname()
  const isSearchActive = pathname === '/'
  const isStatsActive = pathname === '/stats'
  const isAboutActive = pathname === '/about'

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:px-6 sm:py-4">
        <nav aria-label="Main navigation" className="order-2 w-full sm:order-1 sm:w-auto">
          <div className="grid grid-cols-3 gap-1 sm:flex sm:gap-4" style={{ alignItems: 'last baseline' }}>
            <Link
              aria-label="Home"
              className="hidden font-medium text-foreground text-lg transition-colors hover:text-primary md:block"
              href="/"
            >
              awesome-claude-plugins
            </Link>

            <Link
              aria-current={isSearchActive ? 'page' : undefined}
              aria-label="Search repositories"
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-sm ${isSearchActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors sm:min-h-0 sm:justify-start sm:px-0`}
              href="/"
            >
              <Search aria-hidden="true" className="h-5 w-5" />
              <span>Search</span>
            </Link>

            <Link
              aria-current={isStatsActive ? 'page' : undefined}
              aria-label="View statistics"
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-sm ${isStatsActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors sm:min-h-0 sm:justify-start sm:px-0`}
              href="/stats"
              prefetch={false}
            >
              <BarChart3 aria-hidden="true" className="h-5 w-5" />
              <span>Stats</span>
            </Link>
            <Link
              aria-current={isAboutActive ? 'page' : undefined}
              aria-label="About project"
              className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-sm ${isAboutActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors sm:min-h-0 sm:justify-start sm:px-0`}
              href="/about"
              prefetch={false}
            >
              <Info aria-hidden="true" className="h-5 w-5" />
              <span>About</span>
            </Link>
          </div>
        </nav>
        <div className="order-1 ml-auto flex items-center gap-1 sm:order-2 sm:gap-2">
          <Button asChild className="size-11 sm:size-9" size="icon" variant="outline">
            <a
              aria-label="Claude Code documentation"
              href="https://code.claude.com/docs/en/plugins"
              rel="noopener noreferrer"
              target="_blank"
            >
              <ClaudeIcon />
            </a>
          </Button>
          <Button asChild className="size-11 sm:size-9" size="icon" variant="outline">
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
