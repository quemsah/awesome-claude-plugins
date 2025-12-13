interface PluginSourceProps {
  source?: string
  repoPath: string
  defaultBranch?: string
}

export function PluginSource({ source, repoPath, defaultBranch = 'main' }: PluginSourceProps) {
  if (!source) return null

  return (
    <div>
      <h3 className="mb-0.5 font-medium text-sm">Source</h3>
      <p className="break-all text-muted-foreground text-sm">
        <a
          className="underline-offset-4 transition-colors hover:text-primary hover:underline group-hover:text-primary"
          href={`https://github.com/${repoPath}/blob/${defaultBranch}/${source}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {source}
        </a>
      </p>
    </div>
  )
}
