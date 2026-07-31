import type { Metadata } from 'next'
import ReactDom from 'react-dom'
import { findCatalogRepo, getRepoCanonicalPath } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'

type Props = {
  params: Promise<{ repo: string[] }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { repo } = await params
  const repoName = repo.join('/')
  const catalogRepo = findCatalogRepo(repoName)
  const title = catalogRepo ? `${catalogRepo.owner}/${catalogRepo.repo_name}` : repoName
  const description =
    catalogRepo?.description ??
    `Explore ${title} repository with Claude Code plugins, MCP servers, and agent skills. View plugin adoption metrics, AI development tools, and automated workflow integrations`
  const canonicalPath = catalogRepo ? getRepoCanonicalPath(catalogRepo) : repo.map(encodeURIComponent).join('/')
  const canonicalUrl = `${BASE_URL}/${canonicalPath}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'website',
      images: [{ alt: title, height: 630, url: `${BASE_URL}/og/${canonicalPath}`, width: 1200 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${BASE_URL}/og/${canonicalPath}`],
    },
    alternates: {
      canonical: canonicalUrl,
      types: {
        'text/markdown': `${canonicalUrl}.md`,
      },
    },
  }
}

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  ReactDom.preconnect('https://avatars.githubusercontent.com', { crossOrigin: 'anonymous' })
  return <>{children}</>
}
