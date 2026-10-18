import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { RepoPageClient } from '../../components/repo/RepoPageClient.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { findCatalogRepo, getCatalogQualityForRepo, getRepoCanonicalPath } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { GITHUB_API_URL, GITHUB_RAW_URL } from '../../lib/github.ts'
import { createCatalogRepositorySnapshot } from '../../lib/repositorySnapshot.ts'
import type { GitHubRepository } from '../../schemas/github.schema.ts'

type RouteParams = {
  params: Promise<{ repo: string[] }>
}

export const revalidate = 3_600

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { repo } = await params
  if (repo.length !== 2) {
    return {}
  }

  const catalogRepo = findCatalogRepo(repo.join('/'))
  if (!(catalogRepo?.owner && catalogRepo.repo_name)) {
    return {}
  }

  const canonicalPath = getRepoCanonicalPath(catalogRepo)
  const catalogQuality = getCatalogQualityForRepo(catalogRepo)
  const title = `${catalogRepo.owner}/${catalogRepo.repo_name}`
  const description = catalogRepo.description ?? `Explore ${title} in the Awesome Claude Plugins directory.`

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${canonicalPath}`,
      types: {
        'text/markdown': `${BASE_URL}/${canonicalPath}.md`,
      },
    },
    robots:
      catalogQuality.publicationState === 'indexable'
        ? { index: true, follow: true }
        : {
            index: false,
            follow: true,
          },
    openGraph: {
      type: 'website',
      url: `${BASE_URL}/${canonicalPath}`,
      title,
      description,
      images: [{ alt: title, height: 630, url: `${BASE_URL}/og/${canonicalPath}`, width: 1200 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${BASE_URL}/og/${canonicalPath}`],
    },
  }
}

export default async function RepoPage({ params }: RouteParams) {
  const { repo } = await params

  if (repo.length !== 2) {
    notFound()
  }

  const repoPath = repo.join('/')
  const catalogRepo = findCatalogRepo(repoPath)
  if (!catalogRepo) {
    notFound()
  }

  const canonicalPath = getRepoCanonicalPath(catalogRepo)
  if (repoPath !== canonicalPath) {
    permanentRedirect(`/${canonicalPath}`)
  }

  let repository: GitHubRepository
  try {
    // No GitHub request here: the server renders catalog data and the browser refreshes it live.
    repository = createCatalogRepositorySnapshot(catalogRepo)
  } catch (error) {
    console.error('Failed to build catalog repository snapshot', {
      error: error instanceof Error ? error.message : String(error),
      repoPath,
    })
    notFound()
  }

  return (
    <>
      <RepoStructuredData repo={repository} />
      <RepoPageClient
        apiBaseUrl={GITHUB_API_URL}
        owner={repo[0]}
        rawBaseUrl={GITHUB_RAW_URL}
        repo={repository}
        repoName={repo[1]}
        repoPath={repoPath}
      />
    </>
  )
}
