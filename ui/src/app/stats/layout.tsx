import type { Metadata } from 'next'
import { BASE_URL, DEFAULT_OG_IMAGE } from '../../lib/constants.ts'

export const metadata: Metadata = {
  title: 'Repositories Statistics',
  description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
  openGraph: {
    title: 'Repositories Statistics | Awesome Claude Plugins',
    description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
    url: `${BASE_URL}/stats`,
    type: 'website',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Claude Code Plugin Statistics',
      },
    ],
  },
  alternates: {
    canonical: `${BASE_URL}/stats`,
    types: {
      'text/markdown': `${BASE_URL}/stats.md`,
    },
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Repositories Statistics | Awesome Claude Plugins',
    description: 'Explore Claude Code plugin adoption statistics, repository growth trends and usage patterns across GitHub',
    images: [DEFAULT_OG_IMAGE],
  },
}

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
