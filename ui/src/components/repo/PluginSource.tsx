import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'

interface PluginSourceProps {
  source?: string | PluginSourceType
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch }: PluginSourceProps) {
  if (!source) return null

  const sourcePath = typeof source === 'string' ? source : source.source
  const targetRepo = typeof source === 'string' ? repoPath : source.repo
  const branch = typeof source === 'string' ? defaultBranch : (source.branch ?? 'HEAD')

  if (!branch) return null

  return (
    <div>
      <dt className="mb-0.5 font-medium text-sm">Source</dt>
      <dd className="break-all text-muted-foreground text-sm">
        <a
          aria-label={`Open source file ${sourcePath} in a new tab`}
          className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
          href={`https://github.com/${targetRepo}/blob/${encodeURIComponent(branch)}/${sourcePath}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {sourcePath}
        </a>
      </dd>
    </div>
  )
}
