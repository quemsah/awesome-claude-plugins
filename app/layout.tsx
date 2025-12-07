import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '../providers/providers.tsx'

export const metadata: Metadata = {
  title: 'awesome-claude-plugins',
  description: 'Automated collection of Claude Code plugin adoption metrics across GitHub repositories using n8n workflows'
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
