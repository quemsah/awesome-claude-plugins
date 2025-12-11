import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'GitHub Repository Details | Claude Code Plugin Adoption',
  description:
    'View detailed information about GitHub repositories and their Claude Code plugin adoption. Explore repository metrics, plugin usage, and development statistics.',
  keywords: [
    'GitHub repository details',
    'Claude Code plugin adoption',
    'repository metrics',
    'AI plugin usage',
    'developer statistics',
    'open source analytics',
  ],
  openGraph: {
    title: 'GitHub Repository Details | Claude Code Plugin Adoption',
    description:
      'View detailed information about GitHub repositories and their Claude Code plugin adoption. Explore repository metrics and development statistics.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GitHub Repository Details',
    description: 'View detailed information about GitHub repositories and their Claude Code plugin adoption.',
  },
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
