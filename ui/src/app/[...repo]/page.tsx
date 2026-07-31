import type { components } from '@octokit/openapi-types'
import { notFound, permanentRedirect } from 'next/navigation'
import { MarketplacePluginsSchema, type Plugin } from '../../app/types/plugin.type.ts'
import { RepoPageClient } from '../../components/repo/RepoPageClient.tsx'
import { findCatalogRepo, getRepoCanonicalPath } from '../../lib/catalog.ts'
import { fetchGitHubRepository, fetchMarketplace } from '../../lib/github.ts'

type RouteParams = {
  params: Promise<{ repo: string[] }>
}

type Repository = components['schemas']['repository']

export const revalidate = 3_600

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

  let repositoryResponse: Response
  try {
    repositoryResponse = await fetchGitHubRepository(repo[0], repo[1])
  } catch (error) {
    console.error('Failed to fetch repository from GitHub', {
      error: error instanceof Error ? error.message : String(error),
      repoPath,
    })
    throw new Error('Failed to load repository', { cause: error })
  }

  if (repositoryResponse.status === 404) {
    notFound()
  }
  if (!repositoryResponse.ok) {
    throw new Error(`GitHub repository request failed with status ${repositoryResponse.status}`)
  }

  let repository: Repository
  try {
    repository = (await repositoryResponse.json()) as Repository
  } catch (error) {
    console.error('Failed to parse GitHub repository response', {
      error: error instanceof Error ? error.message : String(error),
      repoPath,
    })
    throw new Error('Failed to load repository', { cause: error })
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
  if (marketplaceResult.status !== 404) {
    if (!marketplaceResult.ok) {
      pluginsError = 'Failed to load marketplace manifest.'
    } else {
      try {
        const parsedMarketplace = MarketplacePluginsSchema.safeParse(await marketplaceResult.json())
        if (parsedMarketplace.success) {
          plugins = parsedMarketplace.data
        } else {
          pluginsError = 'Marketplace manifest contains invalid data.'
        }
      } catch {
        pluginsError = 'Marketplace manifest contains invalid data.'
      }
    }
  }

  return <RepoPageClient plugins={plugins} pluginsError={pluginsError} repo={repository} repoPath={repoPath} />
}
