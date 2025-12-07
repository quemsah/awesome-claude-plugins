import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '../providers/providers.tsx'

export const metadata: Metadata = {
  title: 'Dinosaur App (not really)',
  description: 'Run Next.js with Deno',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
