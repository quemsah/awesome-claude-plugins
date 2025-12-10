'use client'

import { BarChart3, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { ThemeToggle } from './ui/theme-toggle.tsx'

export function Header() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex gap-4" style={{ alignItems: 'last baseline' }}>
          <button
            className="text-xl font-bold text-foreground hover:text-primary transition-colors"
            onClick={() => router.push('/')}
            type="button"
          >
            awesome-claude-plugins
          </button>

          <button
            className={`flex items-center gap-2 text-sm ${pathname === '/' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
            onClick={() => router.push('/')}
            type="button"
          >
            <Search className="h-4 w-4" />
            Search
          </button>

          <button
            className={`flex items-center gap-2 text-sm ${pathname === '/stats' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
            onClick={() => router.push('/stats')}
            type="button"
          >
            <BarChart3 className="h-4 w-4" />
            Stats
          </button>
        </div>
        <ThemeToggle />
      </div>
    </header>
  )
}
