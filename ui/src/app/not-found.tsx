import Link from 'next/link'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4" id="main-content" tabIndex={-1}>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-bold text-4xl text-muted-foreground">
            <h1>404</h1>
          </CardTitle>
          <CardDescription className="text-lg">Page Not Found</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">Sorry, we couldn't find the page you're looking for.</p>
          <div className="flex justify-center">
            <Link href="/">
              <Button aria-label="Go to home page" className="w-auto">
                Go Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

export const metadata = {
  title: '404 - Page Not Found | Awesome Claude Plugins',
  description: 'The page you are looking for could not be found',
}
