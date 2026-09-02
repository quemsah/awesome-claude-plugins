import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { RepoPageClient } from '../../components/repo/RepoPageClient.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { findCatalogRepo, getCatalogQualityForRepo, getRepoCanonicalPath } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { fetchGitHubRepository, GITHUB_RAW_URL } from '../../lib/github.ts'
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
  let repositoryIsStale = false
  let repositoryResponse: Response | null = null
  try {
    repositoryResponse = await fetchGitHubRepository(repo[0], repo[1])
  } catch (error) {
    console.error('Failed to fetch repository from GitHub', {
      error: error instanceof Error ? error.message : String(error),
      repoPath,
    })
  }

  if (repositoryResponse?.status === 404) {
    notFound()
  }

  const buildFallbackRepository = (): GitHubRepository | null => {
    try {
      return createCatalogRepositorySnapshot(catalogRepo)
    } catch (error) {
      console.error('Failed to build catalog repository snapshot', {
        error: error instanceof Error ? error.message : String(error),
        repoPath,
      })
      return null
    }
  }

  if (!repositoryResponse) {
    const fallback = buildFallbackRepository()
    if (!fallback) notFound()
    repository = fallback
    repositoryIsStale = true
  } else if (!repositoryResponse.ok) {
    const fallback = buildFallbackRepository()
    if (!fallback) notFound()
    repository = fallback
    repositoryIsStale = true
  } else {
    try {
      const repositoryPayload: unknown = await repositoryResponse.json()
      if (typeof repositoryPayload !== 'object' || repositoryPayload === null) {
        throw new TypeError('GitHub repository response is not an object')
      }
      repository = repositoryPayload as GitHubRepository
    } catch (error) {
      console.error('Failed to parse GitHub repository response', {
        error: error instanceof Error ? error.message : String(error),
        repoPath,
        stack: error instanceof Error ? error.stack : undefined,
      })
      repository = createCatalogRepositorySnapshot(catalogRepo)
      repositoryIsStale = true
    }
  }

  return (
    <>
      <RepoStructuredData repo={repository} />
      <RepoPageClient
        defaultBranch={repository.default_branch}
        owner={repo[0]}
        rawBaseUrl={GITHUB_RAW_URL}
        repo={repository}
        repoIsStale={repositoryIsStale}
        repoName={repo[1]}
        repoPath={repoPath}
      />
    </>
  )
}
