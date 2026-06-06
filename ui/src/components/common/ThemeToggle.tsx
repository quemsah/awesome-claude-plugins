'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '../ui/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu.tsx'

const THEME_LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
} as const

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = mounted ? resolvedTheme === 'dark' : false
  const currentTheme = mounted ? resolvedTheme : 'system'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Current theme: ${THEME_LABELS[currentTheme as keyof typeof THEME_LABELS] || 'System'}`}
          className="relative"
          size="icon"
          suppressHydrationWarning
          variant="outline"
        >
          <Sun
            aria-hidden="true"
            className={`h-[1.2rem] w-[1.2rem] transition-all ${isDark ? 'rotate-90 scale-0' : 'rotate-0 scale-100'}`}
          />
          <Moon
            aria-hidden="true"
            className={`absolute inset-0 m-auto h-[1.2rem] w-[1.2rem] transition-all ${isDark ? 'rotate-0 scale-100' : 'rotate-90 scale-0'}`}
          />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
