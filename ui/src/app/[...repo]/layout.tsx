import type { Metadata } from 'next'
import { BASE_URL } from '../../lib/constants.ts'

type Props = {
  params: Promise<{ repo: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { repo } = await params
  const repoName = repo.join('/')
  const canonicalUrl = `${BASE_URL}/${repoName}`

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
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${repoName}`,
      description: `Explore ${repoName} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools, and automated workflow integrations`,
      type: 'article',
      url: canonicalUrl,
      siteName: 'Awesome Claude Plugins',
      locale: 'en_US',
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
      title: `${repoName} | Awesome Claude Plugins`,
      description: `Explore ${repoName} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools.`,
      images: ['/android-chrome-512x512.png'],
    },
  }
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
