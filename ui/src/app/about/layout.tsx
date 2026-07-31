import type { Metadata } from 'next'
import { BASE_URL, DEFAULT_OG_IMAGE } from '../../lib/constants.ts'

export const metadata: Metadata = {
  title: 'About',
  description:
    'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
  openGraph: {
    title: 'About | Awesome Claude Plugins',
    description:
      'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
    url: `${BASE_URL}/about`,
    type: 'website',
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Claude Code Plugins Directory',
      },
    ],
  },
  alternates: {
    canonical: `${BASE_URL}/about`,
    types: {
      'text/markdown': `${BASE_URL}/about.md`,
    },
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About | Awesome Claude Plugins',
    description:
      'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
    images: [DEFAULT_OG_IMAGE],
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
