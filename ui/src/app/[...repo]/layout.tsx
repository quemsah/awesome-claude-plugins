import type { Metadata } from 'next'
import { BASE_URL } from '../../lib/constants.ts'

type Props = {
  params: Promise<{ repo: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { repo } = await params
  const repoName = repo.join('/')
  const canonicalUrl = `${BASE_URL}/${repo.map(encodeURIComponent).join('/')}`

  return {
    title: `${repoName}`,
    description: `Explore ${repoName} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools, and automated workflow integrations`,
    keywords: [
      'Claude Code plugins',
      'GitHub repository',
      'AI coding tools',
      'MCP servers',
      'Agent skills',
      'Plugin adoption metrics',
      'Repository analytics',
      'AI development tools',
      'Claude Code integration',
      'Automated workflows',
      repoName,
      `${repoName} plugins`,
      `${repoName} Claude Code`,
    ],
    openGraph: {
      title: `${repoName}`,
      description: `Explore ${repoName} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools, and automated workflow integrations`,
      url: canonicalUrl,
      type: 'website',
      images: [
        {
          url: '/android-chrome-512x512.png',
          width: 512,
          height: 512,
          alt: repoName,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${repoName}`,
      description: `Explore ${repoName} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools, and automated workflow integrations`,
      images: ['/android-chrome-512x512.png'],
    },
    alternates: {
      canonical: canonicalUrl,
    },
  }
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
