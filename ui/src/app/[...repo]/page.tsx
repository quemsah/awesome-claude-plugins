import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { MarketplacePluginsSchema, type Plugin } from '../../app/types/plugin.type.ts'
import { RepoPageClient } from '../../components/repo/RepoPageClient.tsx'
import RepoStructuredData from '../../components/repo/RepoStructuredData.tsx'
import { findCatalogRepo, getCatalogQualityForRepo, getRelatedCatalogRepos, getRepoCanonicalPath } from '../../lib/catalog.ts'
import { BASE_URL } from '../../lib/constants.ts'
import { fetchGitHubRepository, fetchMarketplace } from '../../lib/github.ts'
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
  const relatedRepos = getRelatedCatalogRepos(catalogRepo)

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

  if (!repositoryResponse) {
    repository = createCatalogRepositorySnapshot(catalogRepo)
    repositoryIsStale = true
  } else if (!repositoryResponse.ok) {
    repository = createCatalogRepositorySnapshot(catalogRepo)
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

  let marketplaceResult: Response
  try {
    marketplaceResult = await fetchMarketplace(repo[0], repo[1], repository.default_branch)
  } catch (error) {
    console.error('Failed to fetch marketplace manifest', {
      error: error instanceof Error ? error.message : String(error),
      repoPath,
    })
    marketplaceResult = new Response(null, { status: 503 })
  }

  let plugins: Plugin[] = []
  let pluginsError: string | null = null
  let pluginsStatus: 'missing' | 'error' | null = null
  if (marketplaceResult.status === 404) {
    pluginsStatus = 'missing'
  } else {
    if (!marketplaceResult.ok) {
      pluginsStatus = 'error'
      pluginsError = 'Failed to load marketplace manifest.'
    } else {
      try {
        const parsedMarketplace = MarketplacePluginsSchema.safeParse(await marketplaceResult.json())
        if (parsedMarketplace.success) {
          plugins = parsedMarketplace.data
        } else {
          pluginsStatus = 'error'
          pluginsError = 'Marketplace manifest contains invalid data.'
        }
      } catch {
        pluginsStatus = 'error'
        pluginsError = 'Marketplace manifest contains invalid data.'
      }
    }
  }

  return (
    <>
      <RepoStructuredData repo={repository} />
      <RepoPageClient
        plugins={plugins}
        pluginsError={pluginsError}
        pluginsStatus={pluginsStatus}
        relatedRepos={relatedRepos}
        repo={repository}
        repoIsStale={repositoryIsStale}
        repoPath={repoPath}
      />
    </>
  )
}
