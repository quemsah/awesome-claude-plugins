'use client'

import { useEffect } from 'react'
import './globals.css'

type GlobalErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

type ResolvedTheme = 'light' | 'dark'

type Theme = {
  className: string
  colorScheme: ResolvedTheme
}

const DEFAULT_THEME: ResolvedTheme = 'dark'
const THEME_STORAGE_KEY = 'theme-preference'

function isResolvedTheme(theme: string | null): theme is ResolvedTheme {
  return theme === 'light' || theme === 'dark'
}

function resolveStoredTheme(): ResolvedTheme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isResolvedTheme(storedTheme)) return storedTheme
    if (storedTheme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
  } catch {
    return DEFAULT_THEME
  }

  return DEFAULT_THEME
}

// next-themes writes the resolved theme onto the <html> element that app/layout.tsx rendered. Usually that is
// still available while this boundary renders; if the root layout failed before it was applied, fall back to the
// persisted preference so replacing <html> does not reset the error page to the wrong color scheme.
function readTheme(): Theme {
  if (typeof document === 'undefined') return { className: DEFAULT_THEME, colorScheme: DEFAULT_THEME }

  const { className, style } = document.documentElement
  const appliedTheme = className.split(/\s+/).find(isResolvedTheme)
  if (appliedTheme) {
    return {
      className,
      colorScheme: isResolvedTheme(style.colorScheme) ? style.colorScheme : appliedTheme,
    }
  }

  const fallbackTheme = resolveStoredTheme()
  return {
    className: [className, fallbackTheme].filter(Boolean).join(' '),
    colorScheme: fallbackTheme,
  }
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const theme = readTheme()

  return (
    <html
      className={theme.className}
      lang="en-US"
      style={{ colorScheme: theme.colorScheme }}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground">
        <main className="flex min-h-dvh items-center justify-center p-4" id="main-content" tabIndex={-1}>
          <section aria-live="assertive" className="max-w-md text-center" role="alert">
            <h1 className="font-bold text-2xl">Something went wrong</h1>
            <p className="mt-2 text-muted-foreground">Try again, or return to the repository directory.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" onClick={reset} type="button">
                Try again
              </button>
              <a className="rounded-md border px-4 py-2" href="/">
                Back to directory
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  )
}
