import type { CatalogRecord, Repo } from './catalog.js'
import type { MarketplacePluginIssue } from './marketplace.js'

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
export {
  getMarketplacePluginIssue,
  getMarketplacePluginRejection,
  GITHUB_REPO_PATH_PATTERN,
  isMarketplacePlugin,
  isRecord,
  isSafePath,
  isSafePluginId,
  isSafeSourceUrl,
  isValidSource,
  MarketplaceFormatError,
  MarketplaceRootSchema,
  parseMarketplace,
  PLUGIN_ID_PATTERN,
  resolveMarketplacePluginDisplayName,
} from './marketplace.js'

export type { CatalogRecord, MarketplacePluginIssue, PluginSummary, Repo }
export type Marketplace = { plugins: unknown[] }
export { parseStandalonePlugin, StandalonePluginFormatError, toStandaloneCatalogManifest } from './standalonePlugin.js'
export type { StandalonePluginManifest } from './standalonePlugin.js'
