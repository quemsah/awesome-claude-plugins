import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Claude Code Plugin Statistics | Growth Trends & Analytics',
  description:
    'Explore detailed statistics and growth trends of Claude Code plugin adoption across GitHub repositories. Track repository growth, plugin usage patterns, and development trends.',
  keywords: [
    'Claude Code statistics',
    'plugin adoption trends',
    'AI development analytics',
    'GitHub repository growth',
    'Claude plugin usage',
    'AI tool statistics',
  ],
  openGraph: {
    title: 'Claude Code Plugin Statistics | Growth Trends & Analytics',
    description: 'Explore detailed statistics and growth trends of Claude Code plugin adoption across GitHub repositories.',
    url: 'https://claude-plugins.22.deno.net/stats',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Claude Code Plugin Statistics',
    description: 'Explore detailed statistics and growth trends of Claude Code plugin adoption across GitHub repositories.',
  },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
