'use client'

import { BarChart3, Github, Info, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '../ui/button.tsx'
import { ClaudeIcon } from './ClaudeIcon.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export function Header() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) {
        return
      }

      event.preventDefault()
      if (pathname === '/') {
        document.querySelector<HTMLInputElement>('#search')?.focus()
      } else {
        router.push('/#search')
      }
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [pathname, router])

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <a
        className="absolute top-2 left-2 z-50 -translate-y-16 rounded-md bg-background px-3 py-2 font-medium text-sm shadow-sm transition-transform focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="flex items-center justify-between px-4 py-4 sm:px-6">
        <nav aria-label="Main navigation">
          <div className="flex gap-3 sm:gap-4" style={{ alignItems: 'last baseline' }}>
            <Link
              aria-label="Home — awesome-claude-plugins"
              className="hidden font-medium text-foreground text-lg transition-colors hover:text-primary md:block"
              href="/"
            >
              awesome-claude-plugins
            </Link>

            <Link
              aria-current={pathname === '/' ? 'page' : undefined}
              aria-label="Search repositories"
              className={`touch-target flex items-center gap-2 text-sm ${pathname === '/' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/#search"
            >
              <Search aria-hidden="true" className="h-5 w-5" />
              <span className="hidden sm:inline">Search</span>
            </Link>

            <Link
              aria-current={pathname === '/stats' ? 'page' : undefined}
              aria-label="Stats — View statistics"
              className={`touch-target flex items-center gap-2 text-sm ${pathname === '/stats' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/stats"
              prefetch={false}
            >
              <BarChart3 aria-hidden="true" className="h-5 w-5" />
              <span className="hidden sm:inline">Stats</span>
            </Link>
            <Link
              aria-current={pathname === '/about' ? 'page' : undefined}
              aria-label="About — About project"
              className={`touch-target flex items-center gap-2 text-sm ${pathname === '/about' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
              href="/about"
              prefetch={false}
            >
              <Info aria-hidden="true" className="h-5 w-5" />
              <span className="hidden sm:inline">About</span>
            </Link>
          </div>
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <Button asChild className="touch-target h-9 w-9" size="icon" variant="outline">
            <a
              aria-label="Claude Code documentation"
              href="https://code.claude.com/docs/en/plugins"
              rel="noopener noreferrer"
              target="_blank"
            >
              <ClaudeIcon />
            </a>
          </Button>
          <Button asChild className="touch-target h-9 w-9" size="icon" variant="outline">
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
