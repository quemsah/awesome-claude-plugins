import type { PluginSource as PluginSourceType } from '../../app/types/plugin.type.ts'

interface PluginSourceProps {
  source?: string | PluginSourceType
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch = 'main' }: PluginSourceProps) {
  if (!source) return null

  const sourcePath = typeof source === 'string' ? source : source.source

  return (
    <div>
      <h6 className="mb-0.5 font-medium text-sm">Source</h6>
      <p className="break-all text-muted-foreground text-sm">
        <a
          className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
          href={`https://github.com/${repoPath}/blob/${defaultBranch}/${sourcePath}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {sourcePath}
        </a>
      </p>
    </div>
  )
}
