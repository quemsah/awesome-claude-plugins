import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'

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

  const sourcePath = typeof source === 'string' ? source : (source.path ?? source.url ?? source.source)
  const sourceRepo = typeof source === 'string' ? null : source.repo
  const sourceUrlValue = typeof source === 'string' ? null : source.url
  const targetRepo = typeof source === 'string' ? repoPath : sourceRepo
  const branch = typeof source === 'string' ? defaultBranch : (source.branch ?? source.ref ?? source.commit ?? 'HEAD')
  const sourceStringUrl =
    typeof source === 'string' && source.startsWith('github:')
      ? GITHUB_REPO_PATH_PATTERN.test(source.slice('github:'.length))
        ? `https://github.com/${source.slice('github:'.length)}`
        : null
      : typeof source === 'string' && SAFE_SOURCE_PATH_PATTERN.test(source) && targetRepo && branch
        ? `https://github.com/${targetRepo}/blob/${encodeURIComponent(branch)}/${source}`
        : null
  const sourceUrl =
    typeof source === 'string'
      ? sourceStringUrl
      : sourceUrlValue
        ? source.path
          ? `${GITHUB_REPO_PATH_PATTERN.test(sourceUrlValue) ? `https://github.com/${sourceUrlValue}` : sourceUrlValue.replace(GIT_SUFFIX_PATTERN, '')}/blob/${encodeURIComponent(branch ?? 'HEAD')}/${source.path}`
          : GITHUB_REPO_PATH_PATTERN.test(sourceUrlValue)
            ? `https://github.com/${sourceUrlValue}`
            : sourceUrlValue
        : targetRepo && branch
          ? `https://github.com/${targetRepo}/blob/${encodeURIComponent(branch)}/${sourcePath}`
          : null

  if (!sourceUrl) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Source</dt>
      <dd className="break-all text-muted-foreground text-sm">
        <a
          aria-label={`Open source file ${sourcePath} in a new tab`}
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
