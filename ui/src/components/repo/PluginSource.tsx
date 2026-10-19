import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'
import { encodeGitHubPath, getGitHubBlobUrl } from '../../lib/repositoryIdentity.ts'

const GIT_SUFFIX_PATTERN = /\.git$/i
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const SAFE_SOURCE_PATH_PATTERN = /^(?!.*\.\.)(?!.*[\r\n]).+$/

type RepositoryPathKind = 'blob' | 'tree'

/**
 * Convert a git clone URL to a browser URL. For unknown Git hosts, link to the
 * repository rather than guessing a GitHub-specific route that may return 404.
 */
function getRepositoryPathUrl(sourceUrl: string, ref: string, path: string, kind: RepositoryPathKind): string | null {
  const fullUrl = GITHUB_REPO_PATH_PATTERN.test(sourceUrl) ? `https://github.com/${sourceUrl}` : sourceUrl
  try {
    const url = new URL(fullUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null

    const baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '').replace(GIT_SUFFIX_PATTERN, '')}`
    const segments = `${encodeGitHubPath(ref)}/${encodeGitHubPath(path)}`
    const hostname = url.hostname.toLowerCase()

    if (hostname === 'github.com' || hostname === 'www.github.com') {
      return `${baseUrl}/${kind}/${segments}`
    }
    if (hostname === 'gitlab.com' || hostname === 'www.gitlab.com') {
      return `${baseUrl}/-/${kind}/${segments}`
    }
    if (hostname === 'bitbucket.org' || hostname === 'www.bitbucket.org') {
      return `${baseUrl}/src/${segments}`
    }
    return baseUrl
  } catch {
    return null
  }
}

interface PluginSourceProps {
  source?: string | PluginSourceType
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch }: PluginSourceProps) {
  if (!source) return null

  const sourceType = typeof source === 'string' ? null : source.source
  const sourcePath =
    typeof source === 'string'
      ? source
      : (source.path ?? (source.source === 'github' ? source.repo : undefined) ?? source.url ?? source.source)
  // A pinned SHA is what gets installed, even when the manifest also names a moving branch/ref.
  const sourceRef = typeof source === 'string' ? defaultBranch : (source.sha ?? source.commit ?? source.ref ?? source.branch)
  const branch = sourceRef ?? 'HEAD'
  let sourceUrl: string | null = null
  let ariaLabel = `Open source file ${sourcePath} in a new tab`

  if (typeof source === 'string') {
    if (source.startsWith('github:')) {
      const sourceRepo = source.slice('github:'.length)
      if (GITHUB_REPO_PATH_PATTERN.test(sourceRepo)) sourceUrl = `https://github.com/${sourceRepo}`
    } else if (SAFE_SOURCE_PATH_PATTERN.test(source) && defaultBranch) {
      sourceUrl = getGitHubBlobUrl(repoPath, defaultBranch, source)
    }
  } else if (sourceType === 'github' && source.repo && GITHUB_REPO_PATH_PATTERN.test(source.repo)) {
    sourceUrl = `https://github.com/${source.repo}${sourceRef ? `/tree/${encodeGitHubPath(sourceRef)}` : ''}`
    ariaLabel = `Open source repository ${source.repo} in a new tab`
  } else if (sourceType === 'url' && source.url) {
    sourceUrl = GITHUB_REPO_PATH_PATTERN.test(source.url) ? `https://github.com/${source.url}` : source.url
    ariaLabel = `Open source URL ${sourceUrl} in a new tab`
  } else if (sourceType === 'git-subdir' && source.url && source.path) {
    sourceUrl = getRepositoryPathUrl(source.url, branch, source.path, 'tree')
    ariaLabel = `Open source directory ${source.path} in a new tab`
  } else if (sourceType && SAFE_SOURCE_PATH_PATTERN.test(sourceType)) {
    // Legacy marketplace manifests used a file path as the "source" discriminator.
    // Continue rendering those links without treating supported type names as paths.
    if (source.url && source.path) {
      sourceUrl = getRepositoryPathUrl(source.url, branch, source.path, 'blob')
    } else if (source.url) {
      sourceUrl = GITHUB_REPO_PATH_PATTERN.test(source.url) ? `https://github.com/${source.url}` : source.url
    } else if (source.repo && GITHUB_REPO_PATH_PATTERN.test(source.repo)) {
      sourceUrl = getGitHubBlobUrl(source.repo, branch, source.path ?? sourceType)
    }
  }

  if (!sourceUrl) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Source</dt>
      <dd className="break-all text-muted-foreground text-sm">
        <a
          aria-label={ariaLabel}
          className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
          href={sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {sourcePath}
        </a>
      </dd>
    </div>
  )
}
