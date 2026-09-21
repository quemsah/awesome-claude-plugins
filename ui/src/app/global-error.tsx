'use client'

import { useEffect } from 'react'

type GlobalErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

type Theme = {
  className?: string
  colorScheme?: string
}

// next-themes writes the theme onto the <html> element that app/layout.tsx rendered, and this boundary replaces
// that element, so the theme has to be carried over from the element that is still current while rendering.
function readTheme(): Theme {
  if (typeof document === 'undefined') return {}
  const { className, style } = document.documentElement
  return { className, colorScheme: style.colorScheme }
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const theme = readTheme()

  return (
    <html className={theme.className} lang="en-US" style={{ colorScheme: theme.colorScheme }}>
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
