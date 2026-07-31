import process from 'node:process'
import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Header } from '../components/common/Header.tsx'
import { SimpleAnalytics } from '../components/common/SimpleAnalytics.tsx'
import { WebVitals } from '../components/common/WebVitals.tsx'
import { BASE_URL, DEFAULT_OG_IMAGE } from '../lib/constants.ts'
import { Providers } from '../providers/providers.tsx'
import './globals.css'

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: 'Awesome Claude Plugins',
      template: '%s | Awesome Claude Plugins',
    },
    description:
      'Explore the ultimate collection of Claude Code plugins. Discover powerful AI tools, extensions, and integrations across GitHub repositories',
    authors: [{ name: 'Awesome Claude Plugins Team', url: BASE_URL }],
    creator: 'Awesome Claude Plugins Team',
    publisher: 'Awesome Claude Plugins Team',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/favicon.ico' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      ],
      apple: [
        {
          url: '/apple-touch-icon.png',
          sizes: '180x180',
          type: 'image/png',
        },
      ],
    },
    manifest: '/manifest.webmanifest',
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: BASE_URL,
      title: 'Awesome Claude Plugins',
      description:
        'Explore the ultimate collection of Claude Code plugins. Discover powerful AI tools, extensions, and integrations across GitHub repositories',
      siteName: 'Awesome Claude Plugins',
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Awesome Claude Plugins',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Awesome Claude Plugins | AI Development Tools',
      description:
        'Discover powerful plugins, extensions, and tools for Claude AI. Browse curated collections and boost your development workflow',
      creator: '@awesome_claude_plugins',
      images: [DEFAULT_OG_IMAGE],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    alternates: {
      types: {
        'application/feed+json': `${BASE_URL}/feed.json`,
        'text/markdown': `${BASE_URL}/index.md`,
      },
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION_CODE,
    },
  }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171717' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const shouldLoadAnalytics = process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'preview'

  return (
    <html lang="en-US" suppressHydrationWarning>
      <body className="min-h-dvh">
        {shouldLoadAnalytics ? <link crossOrigin="anonymous" href="https://scripts.simpleanalyticscdn.com" rel="preconnect" /> : null}
        <Providers>
          <Header />
          <noscript>
            <p className="border-b px-4 py-3 text-center text-muted-foreground text-sm">
              JavaScript is disabled. You can still browse the catalog, but search and sorting require JavaScript.
            </p>
          </noscript>
          {children}
          <footer className="border-t px-4 py-6 text-center text-muted-foreground text-sm">
            <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/privacy">
              Privacy
            </Link>
          </footer>
        </Providers>
        <SimpleAnalytics enabled={shouldLoadAnalytics} />
        <WebVitals />
      </body>
    </html>
  )
}
