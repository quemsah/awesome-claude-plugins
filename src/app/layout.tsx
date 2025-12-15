import type { Metadata } from 'next'
import './globals.css'
import process from 'node:process'
import GoogleAnalytics from '../components/common/GoogleAnalytics.tsx'
import { GA_ID, isAnalyticsEnabled } from '../lib/analytics.ts'
import { Providers } from '../providers/providers.tsx'

export function generateMetadata(): Metadata {
  const baseUrl = 'https://claude-plugins.22.deno.net'
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: 'Awesome Claude Plugins',
      template: '%s | Awesome Claude Plugins',
    },
    description:
      'Explore the ultimate collection of Claude Code plugins. Discover powerful AI development tools, productivity extensions, and innovative integrations for Claude AI across GitHub repositories.',
    keywords: [
      'Claude Code plugins',
      'Claude AI tools',
      'Claude development tools',
      'Claude Code extensions',
      'AI plugins for Claude',
      'Claude plugin marketplace',
      'GitHub Claude plugins',
      'automated plugin discovery',
      'n8n workflows',
      'AI development tools',
    ],
    authors: [{ name: 'awesome-claude-plugins', url: 'https://claude-plugins.22.deno.net' }, { name: 'Awesome Claude Plugins Team' }],
    creator: 'Awesome Claude Plugins',
    publisher: 'Awesome Claude Plugins',
    icons: {
      icon: [
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
    manifest: '/site.webmanifest',
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: 'https://claude-plugins.22.deno.net',
      title: 'Awesome Claude Plugins',
      description:
        'Explore the ultimate collection of Claude Code plugins. Discover powerful AI development tools, productivity extensions, and innovative integrations for Claude AI across GitHub repositories.',
      siteName: 'Awesome Claude Plugins',
      images: [
        {
          url: '/android-chrome-512x512.png',
          width: 512,
          height: 512,
          alt: 'Awesome Claude Plugins',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Awesome Claude Plugins | AI Development Tools',
      description:
        'Discover powerful plugins, extensions, and tools for Claude AI. Browse curated collections and boost your development workflow.',
      creator: '@awesome_claude_plugins',
      images: ['/android-chrome-512x512.png'],
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
      canonical: baseUrl,
    },
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION_CODE,
    },
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en-US" suppressHydrationWarning>
      <head>
        {isAnalyticsEnabled() && (
          <link as="script" crossOrigin="anonymous" href={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} rel="preload" />
        )}
      </head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <GoogleAnalytics />
      </body>
    </html>
  )
}
