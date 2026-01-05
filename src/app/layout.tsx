import type { Metadata } from 'next'
import './globals.css'
import process from 'node:process'
import Script from 'next/script'
import { Providers } from '../providers/providers.tsx'

export function generateMetadata(): Metadata {
  const baseUrl = 'https://awesomeclaudeplugins.com'
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: 'Awesome Claude Plugins',
      template: '%s | Awesome Claude Plugins',
    },
    description:
      'Explore the ultimate collection of Claude Code plugins. Discover powerful AI tools, extensions, and integrations across GitHub repositories',
    keywords: [
      'Claude Code plugins',
      'Claude AI tools',
      'Anthropic Claude plugins',
      'Claude Code extensions',
      'AI coding agents',
      'MCP servers',
      'Claude skills marketplace',
      'GitHub plugin repositories',
      'Automated plugin discovery',
      'AI development tools',
      'Multi-agent orchestration',
      'Claude Code marketplace',
      'Agent skills',
      'Coding automation',
      'AI plugin directory',
      'Claude development ecosystem',
      'Plugin adoption analytics',
      'GitHub AI tools',
      'Claude Code workflows',
      'n8n automation',
    ],
    authors: [{ name: 'Awesome Claude Plugins Team', url: 'https://awesomeclaudeplugins.com' }],
    creator: 'Awesome Claude Plugins Team',
    publisher: 'Awesome Claude Plugins Team',
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
      url: 'https://awesomeclaudeplugins.com',
      title: 'Awesome Claude Plugins',
      description:
        'Explore the ultimate collection of Claude Code plugins. Discover powerful AI tools, extensions, and integrations across GitHub repositories',
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
        'Discover powerful plugins, extensions, and tools for Claude AI. Browse curated collections and boost your development workflow',
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
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <Script data-collect-dnt="true" src="https://scripts.simpleanalyticscdn.com/latest.js" />
        <noscript>
          {/** biome-ignore lint/performance/noImgElement: <sa> */}
          <img alt="" referrerPolicy="no-referrer-when-downgrade" src="https://queue.simpleanalyticscdn.com/noscript.gif" />
        </noscript>
      </body>
    </html>
  )
}
