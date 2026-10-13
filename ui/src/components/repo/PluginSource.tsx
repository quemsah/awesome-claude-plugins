import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'
import { encodeGitHubPath, getGitHubBlobUrl } from '../../lib/repositoryIdentity.ts'

const GIT_SUFFIX_PATTERN = /\.git$/
const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const SAFE_SOURCE_PATH_PATTERN = /^(?!.*\.\.)(?!.*[\r\n]).+$/

interface PluginSourceProps {
  source?: string | PluginSourceType
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch }: PluginSourceProps) {
  if (!source) return null

  const sourceType = typeof source === 'string' ? null : source.source
  const sourcePath = typeof source === 'string' ? source : (source.path ?? source.url ?? source.repo ?? source.source)
  const sourceRef = typeof source === 'string' ? defaultBranch : (source.branch ?? source.ref ?? source.commit ?? source.sha)
  const branch = typeof source === 'string' ? defaultBranch : (source.branch ?? source.ref ?? source.commit ?? source.sha ?? 'HEAD')
  let sourceUrl: string | null = null
  let ariaLabel = `Open source file ${sourcePath} in a new tab`

  if (typeof source === 'string') {
    if (source.startsWith('github:')) {
      const sourceRepo = source.slice('github:'.length)
      if (GITHUB_REPO_PATH_PATTERN.test(sourceRepo)) sourceUrl = `https://github.com/${sourceRepo}`
    } else if (SAFE_SOURCE_PATH_PATTERN.test(source)) {
      sourceUrl = getGitHubBlobUrl(repoPath, branch ?? 'HEAD', source)
    }
  } else if (sourceType === 'github' && source.repo && GITHUB_REPO_PATH_PATTERN.test(source.repo)) {
    sourceUrl = `https://github.com/${source.repo}${sourceRef ? `/tree/${encodeGitHubPath(sourceRef)}` : ''}`
    ariaLabel = `Open source repository ${source.repo} in a new tab`
  } else if (sourceType === 'url' && source.url) {
    sourceUrl = GITHUB_REPO_PATH_PATTERN.test(source.url) ? `https://github.com/${source.url}` : source.url
    ariaLabel = `Open source URL ${sourceUrl} in a new tab`
  } else if (sourceType === 'git-subdir' && source.url && source.path) {
    const baseUrl = GITHUB_REPO_PATH_PATTERN.test(source.url)
      ? `https://github.com/${source.url}`
      : source.url.replace(GIT_SUFFIX_PATTERN, '').replace(/\/$/, '')
    sourceUrl = `${baseUrl}/tree/${encodeGitHubPath(branch ?? 'HEAD')}/${encodeGitHubPath(source.path)}`
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
