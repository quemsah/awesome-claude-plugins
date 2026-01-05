import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Claude Code Trends & Analytics',
  description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
  keywords: [
    'Claude Code analytics',
    'Plugin adoption statistics',
    'AI development trends',
    'GitHub repository metrics',
    'Claude Code growth charts',
    'MCP server analytics',
    'Agent skills statistics',
    'AI coding tools usage',
    'Plugin marketplace trends',
    'Automated workflow analytics',
    'Claude Code adoption rates',
    'Repository plugin metrics',
  ],
  openGraph: {
    title: 'Claude Code Trends & Analytics',
    description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
    url: 'https://awesomeclaudeplugins.com/stats',
    type: 'website',
    images: [
      {
        url: '/android-chrome-512x512.png',
        width: 512,
        height: 512,
        alt: 'Claude Code Plugin Statistics',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Claude Code Trends & Analytics',
    description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
    images: ['/android-chrome-512x512.png'],
  },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
