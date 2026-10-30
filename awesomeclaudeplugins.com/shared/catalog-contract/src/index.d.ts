import type { CatalogRecord, Repo } from './catalog.js'

export { PluginSummarySchema, PublishedRepoSchema, PublishedReposArraySchema, RepoSchema, ReposArraySchema } from './catalog.js'
export {
  encodeGitHubPath,
  GITHUB_SEGMENT_PATTERN,
  getGitHubBlobUrl,
  getGitHubOwnerUrl,
  getGitHubRepoPath,
  getGitHubRepoUrl,
  isGitHubSegment,
  isValidGitBranch,
  isValidGitHubOwner,
  isValidGitHubPathSegment,
  isValidGitHubRepositoryName,
  isValidGitSha,
  parseGitHubOwnerUrl,
  parseGitHubRepository,
  parseGitHubRepositoryUrl,
} from './identity.js'
export { isMarketplacePlugin, MarketplaceFormatError, parseMarketplace } from './marketplace.js'

export type { CatalogRecord, PluginSummary, Repo }
export type Marketplace = { plugins: unknown[] }
