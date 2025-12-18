import type { Metadata } from 'next'

type Props = {
  params: Promise<{ repo: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { repo } = await params
  const repoName = repo.join('/')

  return {
    title: `${repoName}`,
    description: `View detailed information about the ${repoName} repository and its Claude Code plugins.`,
    keywords: [
      'GitHub repository details',
      'Claude Code plugin adoption',
      'repository metrics',
      'AI plugin usage',
      'developer statistics',
      'open source analytics',
      repoName,
    ],
    openGraph: {
      title: `${repoName}`,
      description: `View detailed information about the ${repoName} repository and its Claude Code plugins.`,
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
      description: `View detailed information about the ${repoName} repository and its Claude Code plugins.`,
      images: ['/android-chrome-512x512.png'],
    },
  }
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
