import type { Metadata } from 'next'
import { BASE_URL, DEFAULT_OG_IMAGE } from '../../lib/constants.ts'

export const metadata: Metadata = {
  title: 'About',
  description:
    'A directory of Claude Code plugins and tools. Compare Awesome Claude Plugins with official Anthropic catalogs and discover how our automated GitHub ecosystem indexing works.',
  openGraph: {
    title: 'About | Awesome Claude Plugins',
    description:
      'A directory of Claude Code plugins and tools. Compare Awesome Claude Plugins with official Anthropic catalogs and discover how our automated GitHub ecosystem indexing works.',
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
      'A directory of Claude Code plugins and tools. Compare Awesome Claude Plugins with official Anthropic catalogs and discover how our automated GitHub ecosystem indexing works.',
    images: [DEFAULT_OG_IMAGE],
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
