'use client'

import { useEffect } from 'react'

type GlobalErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en-US">
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
