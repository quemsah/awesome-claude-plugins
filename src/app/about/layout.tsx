import type { Metadata } from 'next'
import { BASE_URL } from '../../lib/constants.ts'

export const metadata: Metadata = {
  title: 'About',
  description:
    'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
  keywords: [
    'Claude Code directory',
    'Awesome list',
    'Plugin discovery',
    'n8n workflows',
    'GitHub scanning',
    'Claude Code ecosystem',
    'Claude Code plugins',
    'AI coding tools',
    'Automated workflow tools',
    'GitHub plugin search',
  ],
  openGraph: {
    title: 'About',
    description:
      'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
    url: `${BASE_URL}/about`,
    type: 'website',
    images: [
      {
        url: '/android-chrome-512x512.png',
        width: 512,
        height: 512,
        alt: 'Claude Code Plugins Directory',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About',
    description:
      'A daily-updated directory of Claude Code plugins and tools, inspired by the awesome list movement. Automated discovery using n8n workflows scanning GitHub daily.',
    images: ['/android-chrome-512x512.png'],
  },
}

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
