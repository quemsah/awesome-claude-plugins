import Link from 'next/link'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="font-bold text-4xl text-muted-foreground">404</CardTitle>
          <CardDescription className="text-lg">Page Not Found</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-muted-foreground">Sorry, we couldn't find the page you're looking for.</p>
          <div className="flex justify-center">
            <Link href="/">
              <Button className="w-auto">Go Home</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const metadata = {
  title: '404 - Page Not Found | awesome-claude-plugins',
  description: 'The page you are looking for could not be found.',
}
