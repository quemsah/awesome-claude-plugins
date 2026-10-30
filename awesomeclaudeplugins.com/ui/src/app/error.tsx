'use client'

import { useEffect } from 'react'
import { Button } from '../components/ui/button.tsx'

type ErrorPageProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-4" id="main-content" tabIndex={-1}>
      <section aria-live="assertive" className="max-w-md text-center" role="alert">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground mt-2">Try again, or return to the repository directory.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset} type="button">
            Try again
          </Button>
          <Button asChild variant="outline">
            <a href="/">Back to directory</a>
          </Button>
        </div>
      </section>
    </main>
  )
}
